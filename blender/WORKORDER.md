# WORK ORDER — Suite 7 · 3D Blackjack (read this first, do it in order)

You are the Blender-side Claude (Blender 5.2 + MCP, RTX 3060/OptiX). The
website's 3D blackjack game is LIVE with procedural placeholder graphics;
your job is to replace them with real authored assets. `HANDOFF.md` has the
brand context, `coin-handoff.md` the coin's technical history. Palette:
gold #e3c071 / #f7e8ac / #b8934a, crimson #b21d3b, warm near-black #171207,
cream #F5F0F0. Motif: 7♠ and ϕ. NO pink/rose.

⚠️ Lesson from last session (your own notes): run everything HEADLESS
(`blender --background --python <script>.py`) or via MCP commands — do not
drive the GUI. If a script dies, CAPTURE THE TRACEBACK into a text file and
include it in the return zip.

── PRIORITY 1 — the blackjack environment: `table-assets.glb` ─────────────

One .glb containing the named objects + named animation clips below. This
is the entire contract with the website; names are load-bearing.

**Objects**
- `Table` — an ACTUAL blackjack table, the real thing:
  - Classic half-moon/rounded blackjack shape, sized ~6.0 × 3.5 units
    (the site camera looks at it from ~41° pitch, player side nearest).
  - Deep-felt top (near-black warm #0d0a06 felt with subtle cloth normal
    feel), padded leather-look rail around the curve, thin GOLD trim line
    where rail meets felt.
  - One gold betting circle center-front (~r 0.35 at roughly (0, -0.6) in
    table space); a faint printed arc of text on the felt if you like
    ("SUITE 7 · DEALER STANDS ON 17") in gold at low opacity.
  - A **dealer's shoe** on the right side (angled card-dispenser block,
    dark body + gold lip, a card-width slot) and a simple **chip tray**
    recess on the dealer side.
  - Web budget: whole file ≤ ~80k tris; textures ≤ 2048²; materials must
    be Principled BSDF (glTF PBR) — no Cycles-only node tricks; bake any
    fancy shading into textures.
- `Card7S` — the playing card, proportions 0.62 × 0.90 × ~0.02: warm
  near-black face, gold border + mirrored corner "7♠" indices, big center
  spade; patterned back (gold hairlines + faint ♠). `table_assets.py`
  builds a starter version — improve it (real bevel, crisper glyphs).
- `Chip7` — the chip, r 0.16 h 0.045, matching the toon coin's design
  language (already-approved look: red body, cream notches, big 7).

**Animation clips** (names EXACT — the site plays these by name)
- `CardDeal` (~35–45f @30fps) — THE ONE THAT MATTERS. A real "pulled from
  the shoe" deal: the card starts INSIDE the shoe slot, slides out along
  the shoe's angle (short straight pull), releases into a low spinning arc
  across the felt, lands flat with a tiny slide-and-settle (a few cm of
  skid, ~5° residual rotation correcting to 0). Authored from the shoe's
  mouth to table origin — the site offsets/retimes it per seat.
- `CardFlip` (~20f) — hole-card reveal: slight lift (~0.15), π rotation
  about the long axis, set down with a settle.
- `ChipToss` (~24f) — chip tossed onto the betting circle: parabolic arc,
  half-flip, lands with a small bounce + rotation settle.
- Optional bonus if cheap: `CardDiscard` (slide off toward the shoe side).

Export: glTF .glb, animations on (NLA strips named as the actions —
`table_assets.py` shows the pattern), +Y up default exporter settings.
`table_assets.py` is a WORKING STARTING POINT for cards/chips/clips —
extend it with the Table build rather than starting from zero, and fix
whatever crashed last session (traceback wasn't captured; suspects: the
glTF export call or fonts). Verify by re-importing the .glb into a fresh
Blender scene: all 3 objects present, all 3 clips play.

── PRIORITY 2 — `card.png` ────────────────────────────────────────────────

Run/debug `card7.py`: 708×1024 transparent RGBA render of the 7♠ card
(toon look to match the approved chip). This unlocks the site's falling
chips+cards background, which is staged and waiting on exactly this file.

── PRIORITY 3 (optional) ──────────────────────────────────────────────────

- `martini.py` → martini.png (Cycles glass; debug if it crashed).
- Chip denominations: duplicate Chip7 → recolor (25 cream / 100 gold /
  500 crimson bodies), render each as chip-25/100/500.png — the site's
  bet chips can then use real art too.

── RETURN PACKAGE ─────────────────────────────────────────────────────────

Zip back:
- `table-assets.glb`  ← Priority 1
- `card.png`          ← Priority 2
- any denom chip PNGs / martini.png if done
- `NOTES.md` — what you changed, tracebacks hit, anything renamed (nothing
  in the contract may be renamed)

The website Claude wires them in: .glb → components/TableScene.tsx factory
seam (buildCardMesh/buildChipMesh + felt swap), card.png → the falling
background's deck variant, PNGs → public/brand/.
