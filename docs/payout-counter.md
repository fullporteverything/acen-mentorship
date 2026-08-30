# Student payout counter

A Discord "member counter" that shows the total your students have withdrawn,
built from the payouts channel they already post in. **Nothing about this
appears on the website** — the source is a Discord channel, the review queue is
a Discord channel, and the number lives in a Discord channel name.

## How it works

One scheduled route does everything: `GET /api/discord/payouts/tick`, run every
5 minutes by Vercel Cron (`vercel.json`). The rename is throttled separately —
see step 6 — so a faster cron makes the queue more responsive without going
anywhere near Discord's rename limit.

1. **Scan.** The first run has no cursor, so it walks the entire history of the
   payouts channel backwards — that is the "count what's already there" pass. It
   does 20 pages (2,000 messages) per run and remembers where it got to, so a
   huge channel finishes over a few runs instead of timing out. After that it
   only reads what is new.
2. **Read.** `lib/payout-parse.ts` decides whether a message is really a payout.
   It reads the words around the number, not just the number, so `I lost $300`,
   `goal is $10k`, `$150 eval fee` and `congrats on the $2k bro` are all thrown
   out. Confident matches are counted with no human involved.
3. **Read the screenshots.** Any pending post with an image is read by Claude,
   which reports what the screenshot *is* before what it says — a payout
   confirmation, an account balance, a trade's P&L, or something else. Only a
   confidently identified **payout confirmation** counts itself. That gate is
   the whole point: plain OCR would read a $50,000 account size perfectly and
   add it to a public claim about what students have withdrawn. Everything else
   keeps its number as a suggestion and still goes to a human, so a ✅ is one
   click instead of a typing job. 8 images per run, and each image is read once
   ever — never re-read on a later tick.

   Anything it counts on its own is still posted to the review channel, marked
   **Counted automatically**, with ❌ to remove it or a reply to correct the
   figure. Auto-counted rows stay reversible by reaction for 7 days, and by
   reply indefinitely.

4. **Ask.** Anything unclear — `$2,500 🔥` with no payout word, or a screenshot
   with no readable amount — goes to a review channel as a bot post with ✅ and
   ❌ already on it. Five per run, so a first backfill can't flood the channel.
5. **Decide.** React ✅ to count it, ❌ to skip it. If there is no amount (a bare
   screenshot), **reply to the bot's post with the figure** — `$2,500` — and it
   counts that. Replying with a different number corrects a misread one.

   A bare number works — `2500` is as good as `$2,500`. If it can't make out an
   amount in your reply it says so rather than going quiet.

   The bot replies to confirm: *"Finished — counted $2,500. Total is now
   $12,750."* It quotes the figure and the new total on purpose, because what
   you are really checking is not that it heard you but that it took the right
   number rather than keeping its own guess.
6. **Rename.** The counter channel is renamed only when the visible text
   actually changed. Discord allows **2 renames per 10 minutes per channel** and
   silently ignores the excess, so the rename holds its own 9-minute floor
   regardless of how often the route runs, and an unchanged name never spends
   one at all.

Rows are keyed by Discord message id, so re-scanning — or deleting the state row
to force a full re-scan — can never double count. Once a human has decided a row,
the parser never overrules it.

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `CRON_SECRET` | yes | Already set for the YouTube poller. Gates the route. |
| `DISCORD_BOT_TOKEN` | yes | Already set. Needs **View Channel** + **Read Message History** on the payouts channel, **Send Messages** + **Add Reactions** on the review channel, and **Manage Channel** on the counter channel. |
| `DISCORD_PAYOUT_CHANNEL_ID` | yes | The channel students post payouts in. |
| `DISCORD_PAYOUT_REVIEW_CHANNEL_ID` | recommended | Staff-only channel for the queue. Without it, unclear posts pile up unseen. |
| `DISCORD_PAYOUT_COUNTER_CHANNEL_ID` | recommended | The channel to rename. Make it a **voice** channel nobody can connect to — that is how every member counter is built, and voice names keep spaces and capitals. |
| `PAYOUT_REVIEWER_IDS` | no | Comma-separated Discord ids allowed to approve, **in addition to** `ADMIN_DISCORD_ID`. With neither set, nothing can be approved by hand. Anyone on this list can move a public figure, so keep it to accounts you control. A reply from an account not on it gets told so rather than silently dropped. |
| `DISCORD_GUILD_ID` | no | Already set. Only used to build jump links in review posts. |
| `ANTHROPIC_API_KEY` | recommended | Turns on screenshot reading. Without it, every image-only post goes to the review queue unread and you type the amount in. |
| `ANTHROPIC_WORKSPACE_ID` | sometimes | Required if your API key is **identity-linked** — those keys must name the workspace each request acts in, and without it every read fails with a 400 before the image is even looked at. Not needed for a workspace-scoped key. Console → Settings → Workspaces. |
| `PAYOUT_VISION_MODEL` | no | Defaults to `claude-opus-5`. Set `claude-haiku-4-5` to cut the per-image cost roughly fivefold at some accuracy cost. |
| `DISCORD_PAYOUT_COUNTER_TEMPLATE` | no | Default `💰 {total} Paid Out`. The figure leads because Discord truncates a channel name to the sidebar width — with the label first, the number is the part that gets cut. `{total}` compacts (`$342K`), `{exact}` doesn't (`$342,150`). |

Unset the channel ids and the route returns `{ skipped }` and does nothing — the
feature is dormant until it's configured.

## Checking on it

```
curl "https://<site>/api/discord/payouts/tick?key=$CRON_SECRET&dry=1"
```

`diag=1` reports what each channel actually is, a sample of what comes back, the
stored verdict on every pending row, your recent replies with the three things
that must line up for one to count, and one real vision read. `revision=1` lets
vision re-read the pending screenshots — the once-ever guard is right in normal
operation, but a run that failed for an environmental reason would otherwise
poison those rows permanently.

`dry=1` reads the channel and reports what it found without touching Discord —
no review posts, no approvals, no rename — and without advancing the cursor.
(It does still record what it read, which is harmless: rows are keyed by message
id, so the real run lands on the same rows.) Drop it to run for real. The response carries the running total, how far the backfill got, and
a count of every row by status.
