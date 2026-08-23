# SUITE 7 · BLACKJACK — full production manifest

The complete parts list for the finished mini-game. WORKORDER.md is the
current sprint; this is the whole vision so nothing gets designed into a
corner. Everything obeys the brand: gold #e3c071/#f7e8ac/#b8934a, crimson
#b21d3b, warm near-black #171207, cream #F5F0F0, Georgia serif, 7♠ + ϕ.

Site status today: game logic + state machine done (6-deck shoe, H/S/D,
dealer stands 17, 3:2 naturals, play-chips bankroll); three.js scene live
with procedural placeholders; toon chip sprite already shipped.

────────────────────────────────────────────────────────────────────────
## 1 · OBJECTS (Blender → table-assets.glb unless noted)

ENVIRONMENT
- `Table` — half-moon blackjack table (~6.0×3.5u): near-black felt with
  cloth normals, padded rail, gold trim line, betting circle (~r0.35 at
  (0,-0.6)). Felt print in gold, low opacity, the classic arcs:
  "SUITE 7" center · "DEALER STANDS ON ALL 17s" · "BLACKJACK PAYS 3 TO 2"
  · a front "INSURANCE PAYS 2 TO 1" arc (future-proofs the insurance bet).
- `Shoe` — dealer's shoe, right side: angled block, card-width slot, gold
  lip. (May be part of Table mesh but name it as its own object — the site
  anchors the deal animation to it.)
- `DiscardTray` — small tray, left side (used cards slide to it).
- `ChipTray` — dealer-side recess with slots for 3–4 chip rows.
- OPTIONAL dressing: `Martini` (3D version of the site's SVG martini,
  right of player seat), a folded `CutCard` (crimson) laid in the tray.

CARDS
- `Card7S` — hero card mesh (0.62×0.90×0.02, rounded, gold border).
- **Full deck faces = ONE TEXTURE ATLAS, not 52 meshes**: `cards-atlas.png`
  (≤4096², 13 columns × 4 suit rows + card back in a spare cell; each cell
  ≈256×372, style = the approved toon look, gold ♠♣ / crimson ♥♦, lining
  digits, mirrored corner indices). The site re-UVs the one card mesh per
  rank/suit from this atlas. This is the single most valuable texture in
  the project.

CHIPS
- `Chip7` — base chip (r0.16 h0.045), approved toon-red look.
- Denomination variants (recolors of the same mesh/texture):
  25 = cream body/red notches · 100 = gold body/black notches ·
  500 = crimson body/gold notches · 1000 = near-black body/gold (future).
  Deliver as glb variants (`Chip25`,`Chip100`,`Chip500`) OR one mesh +
  `chips-atlas.png` swap textures — author's choice, document it.

SPRITES (2D, public/brand/)
- `chip.png` ✅ shipped (toon) · `card.png` (7♠ portrait, toon) ·
  optional chip-25/100/500.png for HUD use.

────────────────────────────────────────────────────────────────────────
## 2 · ANIMATIONS (named clips in the .glb — names are API)

CORE (sprint 1 — in WORKORDER)
- `CardDeal` — the shoe pull: starts inside the slot, straight pull along
  the shoe angle, low spinning arc, lands with a skid-and-settle.
- `CardFlip` — hole-card reveal: lift ~0.15, π about the long axis, settle.
- `ChipToss` — parabolic toss onto the betting circle, half-flip, bounce.

FULL SET (sprint 2)
- `CardDiscard` — settled cards slide/flick left into the DiscardTray.
- `ChipPayout` — a short stack slides from ChipTray to the bet spot.
- `ChipSweep` — the house drags the losing bet stack toward the tray.
- `ShoeRefill` — between-shoes moment: tray empties, a fresh stack drops
  into the shoe with the cut card (plays behind the "shuffling" note).
- `TableIntro` — 2–3s establishing move for page load: camera-independent
  (animate objects only): chips settle into tray, shoe slides in, felt
  print glints. The site triggers it once on mount.
- NOT needed as a clip: double-down's sideways card — the site rotates the
  landed card 90° itself (real-table convention, zero extra authoring).

TIMING RULES for every clip: 30fps, start/end at rest (frame 1 pose ==
authored origin), no camera or light keyframes inside clips, root motion
on the object itself so the site can offset/retime per seat.

────────────────────────────────────────────────────────────────────────
## 3 · SITE-SIDE (three.js — already built or my job, listed so the split
      of labor is explicit)

- GLTFLoader wiring at the marked factory seam (buildCardMesh/buildChipMesh
  + felt swap) — plays clips by name via AnimationMixer, retimed per seat.
- Win/lose staging (gold light pulse, bet slide, payout pour) — exists.
- VFX layer: gold dust burst on blackjack, soft vignette, felt-level
  reflections — cheap shader/sprite work, not Blender's problem.
- DOM HUD (bets, buttons, banners, bankroll, martini interaction) — done.
- Reduced-motion + WebGL-fail fallbacks — done.

────────────────────────────────────────────────────────────────────────
## 4 · AUDIO (later; NOT Blender — sourced/synthesized separately)

card-slide.mp3 (shoe pull) · card-snap.mp3 (flip) · chip-clink.mp3 (toss,
2–3 variants) · chip-slide.mp3 (payout/sweep) · felt-thud.mp3 (land) ·
shuffle.mp3 (shoe refill) · win-chime.mp3 (subtle, gold) — all short, dry,
quiet-luxury; volume ducked; user-muteable. Site plays them off the same
events that trigger the clips.

────────────────────────────────────────────────────────────────────────
## 5 · GAME FEATURES the assets must not block (roadmap)

v1 (live): solo vs the House, H/S/D, play-chips, martini.
v1.5: splits (two hands side by side — needs nothing new: second hand
  reuses CardDeal offset), insurance (felt arc already printed), audio.
v2: opt-in multiplayer tables (up to ~5 seats — the half-moon table and
  per-seat retiming of CardDeal already assume this), chip leaderboard,
  per-denomination chip art in the HUD.

────────────────────────────────────────────────────────────────────────
## 6 · CONTRACTS (renaming any of these breaks the site)

Objects: `Table` `Shoe` `DiscardTray` `ChipTray` `Card7S` `Chip7`(+denoms)
Clips:   `CardDeal` `CardFlip` `ChipToss` `CardDiscard` `ChipPayout`
         `ChipSweep` `ShoeRefill` `TableIntro`
Files:   table-assets.glb · cards-atlas.png · card.png · chip*.png
Card cell order in the atlas: columns A,2..10,J,Q,K left→right; rows
♠,♥,♦,♣ top→bottom; back in row 5 col 1. Cell size uniform.
Budgets: glb ≤ ~80k tris; any texture ≤4096²; PBR (Principled) only.
