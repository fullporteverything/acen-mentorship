import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * SUITE 7 — READING A PAYOUT OFF A SCREENSHOT.
 *
 * Most members post a picture and nothing else, so without this the counter is
 * a queue of things for the owner to type in by hand — which is the version
 * that stops being maintained after a fortnight.
 *
 * ── THE POINT IS THE CLASSIFICATION, NOT THE OCR ────────────────────────────
 * Pulling a number off an image is the easy half. The half that matters is
 * knowing WHICH number it is. A trading channel's screenshots are mostly not
 * payouts:
 *
 *   a withdrawal confirmation     $2,500   ← the only one that counts
 *   an account balance            $52,300
 *   a day's P&L                   $1,840
 *   an evaluation account's size  $50,000
 *
 * Plain OCR would read all four with equal confidence and quietly add a
 * $50,000 account size to a public claim about student earnings. So the model
 * is asked what the screenshot IS before what it says, and only a confidently
 * identified payout confirmation is allowed to count itself. Everything else
 * keeps its number as a suggestion and still goes to a human.
 *
 * Dormant with no ANTHROPIC_API_KEY: returns null, the screenshot goes to the
 * review queue exactly as it did before, and nothing breaks.
 */

export type ScreenshotKind =
  | "payout_confirmation"
  | "account_balance"
  | "trade_pnl"
  | "other"
  | "unreadable";

export interface VisionReading {
  kind: ScreenshotKind;
  amountCents: number | null;
  confidence: "high" | "medium" | "low";
  /** The text the model says it read, shown in the review post. */
  evidence: string;
}

/** Anthropic accepts these; anything else is skipped rather than guessed at. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** Comfortably under the API's per-image ceiling, and a sane download cap. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const SYSTEM = `You read screenshots posted by retail futures/forex traders in a mentorship Discord and report what they show.

The question you are answering is what KIND of screenshot this is, and only then how much money is on it. Be exact about the kind:

- "payout_confirmation": a WITHDRAWAL or PAYOUT from a prop firm or broker to the trader. Look for words like payout, withdrawal, withdrawn, transfer, "payment sent", "request approved", a payout request table, or a bank/PayPal/Wise credit. The amount is the amount withdrawn.
- "account_balance": an account equity or balance screen. Includes prop-firm dashboards showing account size or current balance.
- "trade_pnl": profit or loss for a trade, a day, or a period. Includes broker P&L tabs and trade tickets.
- "other": anything else — a chart, a chat, a meme, an order ticket with no result.
- "unreadable": you cannot make out the content well enough to classify it.

Report confidence "high" only when the screenshot plainly states what it is AND the amount is unambiguous. If you are inferring the kind from context, that is "medium" at best. If the image is cropped, blurry, or the number could be one of several on screen, say "low".

amountUsd is the single most relevant dollar figure for the kind you chose, as a plain number (2500.5, not "$2,500.50"). Use null when there is no such figure or you cannot read it confidently. Never guess a number that is not visible.

evidence is a short quote of the words and figure you actually read, so a human can check you in one glance.`;

const SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["payout_confirmation", "account_balance", "trade_pnl", "other", "unreadable"],
    },
    amountUsd: { type: ["number", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "string" },
  },
  required: ["kind", "amountUsd", "confidence", "evidence"],
  additionalProperties: false,
} as const;

/** Whether vision is switched on at all. */
export function visionEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function typeFromName(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/** Picks the one attachment worth reading, or null if there isn't one. */
export function firstReadableImage(
  attachments:
    | { url: string; filename?: string; content_type?: string; size?: number }[]
    | undefined
): { url: string; mediaType: string } | null {
  for (const attachment of attachments ?? []) {
    const declared = attachment.content_type?.split(";")[0]?.trim().toLowerCase();
    // Fall back to the extension: content_type is usually present but is not
    // guaranteed, and skipping a real screenshot over a missing header would
    // be an invisible failure.
    const type = declared && IMAGE_TYPES.has(declared) ? declared : typeFromName(attachment.url);
    if (!type) continue;
    if ((attachment.size ?? 0) > MAX_IMAGE_BYTES) continue;
    return { url: attachment.url, mediaType: type };
  }
  return null;
}

/**
 * The outcome of one read, failure included.
 *
 * Returning the REASON rather than null matters: a vision call that quietly
 * returns nothing leaves a row saying "no amount readable" that is
 * indistinguishable from a screenshot with genuinely no amount on it, and the
 * owner has no way to tell a broken integration from a bad screenshot. The
 * error text ends up on the review post.
 */
export type VisionResult =
  | { ok: true; reading: VisionReading }
  | { ok: false; error: string };

/**
 * Reads one screenshot. Never throws — a vision outage must degrade to "a human
 * looks at it", which is the behaviour that existed before this file.
 */
export async function readPayoutScreenshot(image: {
  url: string;
  mediaType: string;
}): Promise<VisionResult> {
  if (!visionEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY not set" };

  try {
    // Sent as bytes rather than as a URL: Discord's CDN links are signed and
    // short-lived, and a fetch failing on Anthropic's side would be invisible
    // here. Downloading first also enforces the size cap ourselves.
    const res = await fetch(image.url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `image download failed: HTTP ${res.status}` };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image too large: ${bytes.byteLength} bytes` };
    }
    const data = Buffer.from(bytes).toString("base64");

    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.PAYOUT_VISION_MODEL?.trim() || "claude-opus-5",
      // Not 1024. Thinking is on by default on this model and is billed against
      // the same budget, so a tight cap can be spent entirely on reasoning —
      // the request then ends at max_tokens having produced no answer at all,
      // which looks exactly like "the screenshot had nothing on it".
      max_tokens: 4096,
      system: SYSTEM,
      // A short extraction with a fixed schema. Low effort is the right setting
      // and keeps the per-image cost down on a job that runs over every
      // screenshot in the channel.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType as "image/png", data } },
            { type: "text", text: "What does this screenshot show?" },
          ],
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      return {
        ok: false,
        error: `no answer in response (stop_reason: ${response.stop_reason})`,
      };
    }
    const parsed = JSON.parse(text.text) as {
      kind: ScreenshotKind;
      amountUsd: number | null;
      confidence: "high" | "medium" | "low";
      evidence: string;
    };

    const usd = typeof parsed.amountUsd === "number" && Number.isFinite(parsed.amountUsd)
      ? parsed.amountUsd
      : null;
    return {
      ok: true,
      reading: {
        kind: parsed.kind,
        amountCents: usd !== null && usd > 0 ? Math.round(usd * 100) : null,
        confidence: parsed.confidence,
        evidence: (parsed.evidence ?? "").slice(0, 300),
      },
    };
  } catch (error) {
    console.error("[payouts] vision read failed", error);
    return { ok: false, error: String(error).slice(0, 300) };
  }
}
