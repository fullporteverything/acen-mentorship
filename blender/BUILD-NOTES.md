# Suite 7 — blackjack assets · build notes

> **Sprint 2 is complete.** See the sprint 2 section at the foot of this file.
> `out/` now holds 7 deliverables and the .glb carries **8** clips.

Built live through blender-mcp against Blender **5.2.0 LTS**, RTX 3060.
Everything below was inspected in-viewport and re-measured after each step.

## Deliverables

| File | What |
|---|---|
| `out/table-assets.glb` | Priority 1. 6 objects, 4 clips. *(sprint 2: 8 clips, 823,428 bytes)* |
| `out/card.png` | Priority 2. 708×1024 transparent RGBA, toon. |
| `out/chip-25.png` `chip-100.png` `chip-500.png` | Priority 3 denominations, 1024² transparent. |
| `blender/out/s7_scene.blend` | The full authored scene. |
| `out/tracebacks/` | The three failures that were hit and fixed (below). |

**Nothing was renamed.** `Table` `Shoe` `DiscardTray` `ChipTray` `Card7S`
`Chip7` and `CardDeal` `CardFlip` `ChipToss` `CardDiscard` are all exactly as
specified, confirmed by re-importing the .glb into a fresh scene.

**Final tri count: 22,146** of the ~80,000 budget (28%). Textures: none —
every marking is geometry, so there is nothing to exceed 2048². All materials
are Principled BSDF. No Shader-to-RGB, no Cycles-only nodes, and no
inverted-hull outline anywhere in the .glb.

### Verified by re-import
```
VERIFY: PASS
objects: Card7S, Chip7, ChipTray, DiscardTray, Shoe, Table
clips:   CardDeal, CardDiscard, CardFlip, ChipToss
Table 6.000 × 3.500 · Card7S 0.620 × 0.900 × 0.020 · Chip7 0.320 × 0.320 × 0.045
```

---

## Tracebacks hit

Three, all fixed; files kept in `out/tracebacks/`.

1. **`TRACEBACK_felt.txt`** — `bpy_struct: item.attr = val: enum "BASELINE" not
   found in ('TOP','TOP_BASELINE','CENTER','BOTTOM_BASELINE','BOTTOM')`.
   Blender 5.2 has no plain `BASELINE` for `TextCurve.align_y`. Now uses
   `BOTTOM_BASELINE` (identical to `TOP_BASELINE` for single-line text).
2. **`TRACEBACK_clips.txt`** — `'Action' object has no attribute 'fcurves'`.
   Blender 5.2 ships **slotted actions**: curves moved to
   `action.layers[].strips[].channelbags[].fcurves`. `s7_clips.action_fcurves()`
   now handles both layouts, and `bake()` raises if it ever bakes zero keys
   rather than silently producing an empty clip.
3. **`TRACEBACK_card7.txt`** — `enum "BLENDER_EEVEE_NEXT" not found in
   ('BLENDER_EEVEE','BLENDER_WORKBENCH','CYCLES')`. The EEVEE identifier moved
   twice (`BLENDER_EEVEE` → `BLENDER_EEVEE_NEXT` in 4.2 → back in 5.x).
   `card7.setup_render` now reads the enum off the running build.

---

## The one that would have bitten silently

**`bpy.ops.object.origin_set` does nothing when driven over blender-mcp.**
`bpy.context.area` is `None` there, so the operator fails its poll — and
raises *nothing*. `s7_common.glyph()` relied on it to centre each glyph on its
ink, so every glyph in the project was sitting at its font-metric offset
instead. Measured on `Card7S`:

```
target: 7 at (-0.205, 0.325)
actual: y span 0.146 .. 0.231  ->  centre 0.189   (0.136 low)
```

That put the corner "7" straight through the spade under it. `glyph()` now
centres and scales by editing mesh data directly, with no `bpy.ops` at all —
same result, and it works headless. This is worth remembering: **`origin_set`
and other 3D-view-context operators are unreliable over MCP and fail quietly.**
`s7_table` and `s7_props` avoid `bpy.ops.mesh.spin` for the same reason.

A related trap: `obj.dimensions` is served from a cached bound box and is
stale until the depsgraph ticks. Reading it right after editing mesh data
returned the *pre-scale* thickness and sank every index glyph inside the card,
where it vanished. All such measurements now read mesh vertices directly.

---

## What changed and why

### `s7_table.py` — geometry bugs found by measuring the built result

- **The felt had zero inset at the front.** `outline()` is parameterised by a
  straight back edge `y_back` *and* a front half-ellipse whose semi-axis
  `depth` is measured from that same y. Reducing both by the inset cancels:
  `(y_back−k) − (depth−k) == y_back − depth`. Measured: felt front edge
  `−1.750`, table edge `−1.750`, inset `0.000` where 0.26 was intended. Correct
  inset is `y_back−k` with `depth−2k`.
- **The rail tube overhung the table**, reaching `y = −1.893` against a −1.750
  edge, so `Table` measured 6.02 × 3.64 instead of 6.00 × 3.50. Rail
  centreline and bevel radius now sum exactly to the outer edge. Table is now
  **exactly 6.000 × 3.500**.
- **`ChipTray` was floating in the dealer notch void** — 0.67 from the notch
  centre against a notch radius of 0.95, i.e. off the table entirely.
- **The dealer notch was a half-circle 1.9 wide × 0.95 deep.** Real blackjack
  scallops are wide and shallow; that one was eating the felt the chip tray
  needed. Now an ellipse, 2.6 wide × 0.52 deep. `outline()` takes the scallop
  centre separately, because under inset the ellipse centre stays put while
  the back edge moves — it is clamped to the back edge rather than poking
  above it.

### `s7_table.py` — the felt print

All three arcs plus the wordmark shared `cy = 0.62`, so they bunched and ran
straight through the betting circle. Also:

- **`arc_text` rotated each glyph by `−a` where it should be `+a`.** A glyph
  below the arc centre needs its local +Y pointing *toward* that centre for a
  reader at −Y; the sign error mirrored the lean either side of centre, which
  is what made the rows read as splayed and upside-down.
- **Long strings on small radii climb.** `"BLACKJACK PAYS 3 TO 2"` at r=1.22
  swept 91° and rose 0.36. The three rows now share one centre well above the
  table (`PRINT_CY = 3.10`) with **nested** radii 3.04 / 3.29 / 3.52, sweeping
  49° / 42° / 26°. `"INSURANCE PAYS 2 TO 1"` is the outermost, nearest the
  player, as requested.
- **Georgia ships old-style figures** (3 4 5 7 9 descend, 1 and 2 are
  x-height). `C.glyph` normalises each glyph's ink to one height, so numerals
  were blown up to cap height and centred on their own ink — the wandering
  "PAYS **3** TO 2". Rows are now set with one shared em size on one shared
  baseline, and advance **proportionally** by each glyph's own ink width.

Verified there are no overlaps left, top to bottom, with the gap above each:
```
ChipTray  +0.070 · SUITE 7 +0.072 · BLACKJACK +0.123
DEALER MUST STAND +0.131 · INSURANCE +0.137 · BetCircle +0.096 · felt edge +0.250
```

### `s7_props.py` (new) — `Card7S` and `Chip7`

**Card7S**, exactly 0.620 × 0.900 × 0.0200, 3,726 tris. The brief's bevel
gotcha is real but I took the other route: the corner radius is generated in
the **profile** (`rounded_rect` → solidify), so no bevel is doing the corners
and there is nothing to clamp. Bevelling a 0.20 slab works, but the same
bevel also rounds both face rims by 0.05, eating 0.10 of a 0.62-wide face
before anything is drawn on it. A separate 0.0035 bevel — far below the clamp
threshold — does the edge softening.

Printed elements are sunk so each clears its face by exactly 0.0012 with the
rest of the body buried in the slab. Without that the 0.0055 piping tube stood
fully proud and the card measured **0.029** thick instead of 0.020.

**Chip7**, 0.320 × 0.320 × 0.045, 1,464 tris. Built as a lathed (r, z) profile
so it gets a genuinely **recessed face with a raised rim ring**, matching
`renders/chip_toon.png`. The lathe is written straight into mesh data rather
than using `bpy.ops.mesh.spin` (edit-mode context) or a boolean (the
empty-material-slot-at-index-0 gotcha). The body stops at r=0.1585 so the cream
edge notches are the widest part, keeping the finished diameter exactly 0.320.
The 7 was sized up to fill the recess as the reference does.

### `s7_clips.py` (new) — the four clips

30 fps, baked one key per frame, **LINEAR** interpolation (the easing is
already in the sampled values; Bezier auto-handles would overshoot between
samples and put back the wobble the maths removes). Root motion on the object.
No camera or light is keyed — none is created. Each action is pushed to its
own NLA track with **track, strip and action identically named**, so the clip
name survives whichever naming rule the exporter applies.

Two automated checks run before baking:

- `rest_check()` — every clip must start and end at rest. Tested as a *ratio*
  (first/last frame step vs the clip's peak step), because at 30 fps even a
  perfectly eased start moves a little. **This caught a real bug:** `CardFlip`
  used `sin(πu)` for its lift, whose derivative is *largest* at u=0, so the
  card left the felt at full speed. Replaced with `sin²(πu)`, which has the
  same single peak but zero slope at both ends.
- `square_check()` — final Z must be a whole number of turns. Z only:
  `CardFlip` deliberately ends at π about Y, since that half-turn is the reveal.

**CardDeal** (40f), measured from the baked result:
```
f1   (+1.819, +0.892, +0.240)  inside the shoe bbox (x 1.55‑2.20, y 0.65‑1.37, z 0.01‑0.38)
f1‑8  straight pull along the shoe's −26°, z constant
f12‑30 spinning arc, descending 0.248 → 0.080
f33  touchdown (+0.069, +0.029, 0.020) at −715° — 5° residual
f40  (0, 0, 0.020) at −720.0°  =  −2.0000 turns exactly → lands square
```
Skid is 0.075 from touchdown to rest.

### `card7.py` — rewritten

It built its **own, simpler card**, which meant the falling-background art and
the card in the .glb would drift apart the moment either changed. It now
renders the canonical `s7_props.build_card()`, so there is exactly one Card7S
design. It also had `OUT` pointing at `...\Downloads\suite7\out\` — a different
project — and the same `origin_set` bug. Verified output is byte-exact to the
palette: face `#171207`, pips `#f7e8ac`, corners fully transparent.

The toon treatment (flat emission + inverted-hull outline) lives **only** in
the sprite renders. It relies on `use_backface_culling`, which is EEVEE-only
and does not survive glTF.

---

## Deviations you should know about

1. **The betting circle sits at (0, −0.90) r 0.34, not (0, −0.60) r 0.35.**
   With three spread arcs and "INSURANCE PAYS 2 TO 1" pushed toward the
   player, a circle at −0.60 lands on top of the insurance row. `ChipToss`
   reads `T.BET_CIRCLE` rather than a hard-coded target, so the chip lands on
   whatever circle actually exists — move the constant and the clip follows.
2. ~~**`ChipTray` sits on the felt rather than being recessed into it.**~~
   **Resolved in sprint 2** — a real 0.050 pocket is now cut with a boolean.
3. **`s7_common.pbr()` now also sets `m.diffuse_color`.** Purely so SOLID
   viewport shading and the outliner show the real hue instead of white —
   glTF ignores the field.
4. **`build_chip()` gained `label` / `body_color` / `name` parameters** for the
   denominations. Defaults are unchanged; regression-checked that `Chip7`
   still comes out with identical name, dims and materials.
5. On the cream and gold denomination chips the stock cream notches and pale
   numeral vanish into the body — flat toon has no shading to separate
   same-value regions, and the inverted hull draws only the silhouette. Those
   two use dark accents plus an explicit recess line, chosen by body
   luminance. Sprite-only; `Chip7` in the .glb is untouched.

## Not done *(as of sprint 1 — both were completed in sprint 2)*

- ~~**`martini.py` → `martini.png`**~~ (Priority 3, optional). Not attempted
  in sprint 1; **done in sprint 2**.
- ~~**`cards-atlas.png`**~~ — out of scope for sprint 1; **done in sprint 2**.

---
---

# Sprint 2

Same rules held: nothing renamed, everything checked in-viewport or measured
before moving on. **Final tri count: 22,182** of ~80,000 (28%).

## Deliverables in `out/`

| File | |
|---|---|
| `table-assets.glb` | 823,428 bytes. 6 objects, **8** clips. |
| `cards-atlas.png` | 3328 × 1860 RGBA, 13 × 5 cells of 256 × 372. |
| `card.png` | 708 × 1024, unchanged from sprint 1. |
| `chip-25/100/500.png` | 1024², unchanged. |
| `martini.png` | 640 × 1024 Cycles glass, transparent. |

### Verified by re-import
```
VERIFY: PASS
objects (6/6): Card7S, Chip7, ChipTray, DiscardTray, Shoe, Table
clips   (8/8): CardDeal, CardDiscard, CardFlip, ChipPayout,
               ChipSweep, ChipToss, ShoeRefill, TableIntro
TRIS 22,182 / 80,000
```

## Priority 1 — `cards-atlas.png`

Generated with **Pillow, not Blender** (installed Pillow 12.3.0). 52 faces are
2D typography; 52 Blender scene builds would be slower and give worse glyph
control. It runs in about a second.

Geometry is expressed in the **same card units as `s7_props.build_card()`**
(0.62 × 0.90, radius 0.045, borders inset 0.034 / 0.055) and scaled into the
cell, so the atlas and the 3D card cannot drift apart.

**The bug worth recording: the corner index collided with the pip columns.**
`"10"` set as a plain string measures **0.142 card units** against an index
budget of ~0.084 — it ran straight through the left pip column on all four
`10` cards. Two fixes, in order:

1. Ranks are now set **glyph-by-glyph, each cropped to its ink and butted with
   tight tracking**. Most of that 0.142 was per-glyph sidebearing that a corner
   index does not need; removing it got `"10"` to nearly full size rather than
   being shrunk to fit.
2. `render_rank` then **iterates** the fit — font sizes are integers, so a
   single proportional rescale still landed a pixel or two over budget (gap
   came out +0.0032 against a +0.0040 minimum).

The build now **asserts** the clearance and refuses to write a colliding
atlas; it prints the tightest gap every run (currently `10H = +0.0044`).
`verify()` additionally re-opens the PNG and checks the grid is 13 × 5, that
all 52 face cells are ≥80% opaque, that the back is at row 5 col 1, and that
the rest of row 5 is transparent.

Sizing is by **ink height, not point size** — the same old-style-figures
problem as the felt print, and the same fix, which also keeps the atlas
consistent with `C.glyph`.

## Priority 2 — the four new clips

`ChipPayout` (28f) · `ChipSweep` (30f) · `ShoeRefill` (48f) · `TableIntro`
(75f = 2.5 s). 30 fps, root motion on the objects, no camera or light keyed —
none is created.

**Multi-object clips.** `ShoeRefill` and `TableIntro` both move two objects,
and Blender has no multi-object action. Each participant gets its own NLA
track carrying the **same track name**; the glTF exporter groups tracks by
name in `NLA_TRACKS` mode, so they arrive as one animation. Confirmed by the
round trip — `ShoeRefill` comes back with 14 curves (Card7S + Shoe). Blender
suffixes the second Action `.001`; that is internal, the exported name comes
from the track.

- `ChipPayout` lifts clear of the rack, arcs to the bet spot, settles.
- `ChipSweep` is its exact inverse and is **dragged, not tossed** — it stays
  on the felt and only rises at the end to clear the tray wall.
- `ShoeRefill` drops the cut card into the shoe on an accelerating fall; the
  Shoe takes the weight with a damped dip four frames before the card lands.
- `TableIntro` slides the shoe in from off-table while a chip drops into the
  rack and double-bounces.

The bet spot is read from `T.BET_CIRCLE`, never hard-coded, as instructed.

Both automated checks still gate the bake, and `build_clips` now **runs them
itself** before baking rather than relying on the caller — I hit a `KeyError`
calling `rest_check()` before `capture_rest()` had populated the Shoe's rest
transform, which is exactly the kind of ordering mistake the checks exist to
prevent.

`square_check` gained an exemption list: `ShoeRefill` and `TableIntro`
deliberately finish squared **to the shoe**, which sits at −26°, so demanding
a whole number of turns there would be wrong.

Rest transforms are read off the built objects (`capture_rest`), not restated
as constants — the Shoe's z is solved at build time from its tilted bbox, so
hard-coding it would silently drift the moment the shoe moves.

## Priority 3

**`ChipTray` recess — the boolean.** Cut with a DIFFERENCE boolean, pocket
0.050 deep. The documented gotcha needed a different fix than usual: the
standard remedy, `C.set_material`, would have been **wrong** here, because
`Table` carries five materials and that helper forces every polygon onto one —
it would have flattened felt, rail, trim and print into a single colour. So
the cutter is given a real material (`S7_TrayPocket`) and transferred, and
`build_table` then **audits** the result, raising if any slot is empty or any
polygon points at one. Clean:

```
S7_Rail 3,152 · S7_Felt 2 · S7_TableGold 3,024 · S7_FeltPrint 1,236
S7_TrayPocket 4      empty slots: []   polys pointing at one: 0
```

The rack now stands 0.040 proud of the felt instead of sitting entirely on it.
`s7_clips.CHIP_TRAY_Z` is **derived** from `CHIPTRAY_RECESS` so the payout and
sweep clips follow the pocket automatically.

**`martini.py`.** Carried the same two bugs as `card7.py` — `OUT` hard-coded to
`...\Downloads\suite7\out\` (a different project) and `file_format = "PNG"`
without setting `media_type = "IMAGE"` first. It also rendered on **CPU**;
Cycles is now pushed onto the 3060 via OptiX.

It then rendered, but **wrong** — opaque grey plastic rather than glass. The
cause is interesting: it inherited the coin's Light-Path world trick, where
non-camera rays see a flat grey. That is right for metal, which only needs
something bright to reflect, and wrong for glass, which is *read through* — a
uniform environment refracts to a uniform wash. Replaced with a vertical
gradient so refraction has structure to bend, added a rim light (a transparent
film gives the silhouette nothing to separate against), and saturated the
liquid, which had been pale enough to disappear.

## Deviations still standing from sprint 1

1. Betting circle at **(0, −0.90) r 0.34**, not (0, −0.60) — three spread felt
   rows leave no room at −0.60. This sprint's brief confirms −0.90, so it is
   now settled. All chip clips read `T.BET_CIRCLE`.
2. `s7_common.pbr()` sets `m.diffuse_color` so SOLID shading shows real hues.
3. `build_chip()` takes `label` / `body_color` / `name` for the denominations;
   `Chip7` itself is regression-checked to be unchanged.
4. The cream and gold denomination sprites use dark accents chosen by body
   luminance — flat toon has no shading to separate same-value regions.
   Sprite-only; `Chip7` in the .glb is untouched.

## Note for whoever picks this up

The atlas is a **separate pipeline** from the .glb — it is not referenced by
`table-assets.glb`, which still carries geometry-only card markings. Wiring
the site's re-UV path to the atlas is a website-side change; if you later want
the 3D `Card7S` to use the atlas too, its face would need UVs mapped to a cell
and the geometric pips removed.

---
---

# Sprint 2 · WORKORDER-2 — the dealer, the bigger table

Built live over MCP against Blender 5.2.0 LTS. **Final tri count: 47,490**
of the raised ~140,000 budget (34%). Nothing renamed; everything from
sprint 1 keeps its name and stays in the file.

## Contract now in `table-assets.glb`

```
objects (8)  Table  Shoe  DiscardTray  ChipTray  Card7S  Chip7  Table5  Dealer
clips  (12)  CardDeal CardFlip CardDiscard ChipToss ChipPayout ChipSweep
             ShoeRefill TableIntro
             DealerIdle DealerDeal DealerFlip DealerSweep
```

**`DealerIdle` IS A LOOP** — play it on repeat. Every other clip plays once.
`s7_build.LOOPING` carries this flag in code.

Verified twice: by re-import into a fresh scene (8/8 objects, 12/12 clips),
and by reading the .glb's own JSON — 8 meshes, 20 nodes, 1 skin
(`DealerRig`), 12 animations. Do not trust the re-import object list alone:
this session's Blender adds a stray `Icosphere` on import that is **not in
the file**. Reading the glTF JSON is the check that actually settles it.

## Priority 1 — the Dealer

`Dealer` is one skinned mesh (3,292 tris) on an 11-bone `DealerRig`.
Faceless and neck-down: the top of the torso is a flat dark disc reading as
collar shadow. Shoulders 1.38 (23% of the table's width), neck 1.64 above
the felt, hands resting at the felt edge at y = 1.00.

**Rigid skinning, no weight painting.** Each part is weighted 1.0 to exactly
one bone via a vertex group named after it, then the parts are joined —
vertex groups survive a join. This cannot produce the soft-weight artefacts
a quick auto-weight would.

`bpy.ops.object.mode_set` **does** work over MCP — verified before relying on
it. That matters because bones can only be created in edit mode, and the
sprint-1 lesson was that `origin_set` fails *silently* here. Test the
operator before you build on it; do not assume either way.

Three passes were needed, and the first two were wrong in instructive ways:

1. **Lampshade.** Shoulders 1.28 across a 1.11-tall torso — wider than the
   body was tall — with a hard shoulder ring and a steep cone to the neck.
   It rendered as a flared bucket with a domed lid.
2. **Bib.** Replacing the vest with a closed dark shell just made a barrel.
   What makes a suit legible at a glance is the *opening*: the jacket is now
   an open-front shell (front arc omitted, solidified for real thickness)
   with lapels framing a V of shirt and gold tie, plus sleeves, contrast
   cuffs and gold links. The first lapel attempt displaced the tip along -Y,
   which stood them off the chest like a shelf and lit them as two pale
   triangles; walking *around the body* instead keeps them flat, which is
   what a lapel is.
3. **Undersized.** At the site's real 41 deg framing he read as a doll. A
   standing dealer meets a table at the waist, so the neck belongs ~1.7
   above the felt, not 1.0. Scaled to human proportions, and `DY` moved
   1.62 -> 1.70 because at the wider shoulder the torso front landed at
   y 1.29 against a notch boundary of 1.302 — just inside the tabletop.

Clip checks mirror the sprint-1 ones but split by kind: `rest_check` asserts
non-looping clips start and end in the rest pose, and `loop_check` asserts
`DealerIdle` matches in **value and slope** at the seam. Every term in the
idle pose is periodic with a whole number of cycles, which is what makes the
loop seamless rather than merely continuous.

**Deviation.** `DealerDeal` *gestures* toward the Shoe; the hand does not
literally reach it. The shoe mouth is ~1.27 from the shoulder against ~1.0
of arm, so contact needs IK and a longer arm. At 41 deg pitch the gesture
reads, and the reach peaks at frame 8 — exactly when `CardDeal`'s card
clears the shoe lip — so firing them together lands the timing the work
order asked for.

## Priority 3 — Table5

7.395 x 3.900, five circles fanned along the player arc, centre seat exactly
on Table's `(0, -0.90) r 0.34`. Built as a **separate module** importing
`s7_table` rather than a refactor of it: `build_table()` is what produced
the Table already wired into the site, and the surest way to keep it
untouched is not to edit the file.

Furniture is deliberately **not** moved and the tray pocket is cut in the
same place, so the site swaps one mesh and repositions nothing.

Two things the layout checker caught before they shipped:

- The centre seat first landed at -1.160. The inset had been derived from
  `Y_BACK - DEPTH`, but the felt's front edge is
  `(Y_BACK - RAIL_W) - (DEPTH - 2*RAIL_W)` = -1.69. `BET_INSET` is now
  derived from the real edge, not typed.
- With that corrected the seats fanned up through the insurance row. Seat
  spread widened to 30 deg and Table5's inherited print lifted by 0.20 —
  same content, same curvature, only the arc centre moves, so the radii are
  untouched.

## Priority 4

- **ChipTray recess: done** (sprint 1, carried forward). Real 0.050 pocket,
  boolean. The usual `C.set_material` fix would have been *wrong* here —
  Table carries five materials and that helper forces every polygon onto one.
  The cutter gets a real material, transferred, and `build_table` audits the
  result and raises if any slot is empty or any polygon points at one.
- **Dealer-row nudge: no longer needed.** With the tray recessed 0.050 into
  the felt, a card at the `CardDeal` end pose (spanning y -0.45..0.45)
  clears the tray footprint (0.52..0.92) by 0.07 *and* sits above a tray
  that is now sunk rather than proud. Left as authored.
- **`martini.png`: done** (sprint 1). It had the same two bugs `card7.py`
  did — output path pointing at a different project, and `file_format` set
  before `media_type` — plus it rendered on CPU and, once fixed, came out as
  opaque grey plastic. It had inherited the coin's flat-grey Light-Path
  world, which is right for metal (needs something to reflect) and wrong for
  glass (gets read *through* — a uniform environment refracts to a uniform
  wash). A gradient world fixed it.

## Pipeline now lives in the repo

`blender/` previously held pre-sprint-1 copies of `s7_common`/`s7_table` and
none of the newer modules, while `public/brand/` held assets those files
could not produce. Everything that builds the assets is now committed:
`s7_common s7_table s7_table5 s7_props s7_clips s7_dealer s7_build
cards_atlas card7 martini render_chips`. No more zipping.

---
---

# Sprint 3 · WORKORDER-3 — the dealer's silhouette

**Tri count 61,570 of the ~140k budget. Dealer alone: 3,972 of his 35k.**
Object, rig, bone and clip names all unchanged; `DealerIdle` still loops.

## The test render is the headline

`blender/shots/dealer-sprint2-before.png` and `-sprint3-after.png` are the
same frame from the site's camera — `(0, 7.25, 11.63)` → `(0, -0.20, -0.75)`,
fov 36, aspect 1.78, table present.

**This is the finding of the sprint.** Sprint 2 declared the lampshade
solved on the strength of close-up viewport checks at 20–40° from two
metres away. At the site's actual camera — 31° down, figure at 18.5% of
frame width — it was still obviously a lampshade. The close-up was not a
weaker version of the real view, it was a *different* view that happened
to hide the exact defect. `s7_shot.py` now reproduces the site camera
exactly, and nothing about this model should be judged any other way.

The conversion is worth keeping: the glb is +Y up, so Blender `(bx,by,bz)`
arrives as `(bx, bz, -by)` and the site then applies `TABLE_SCALE = 1.9`.
A site point `(X,Y,Z)` is therefore Blender `(X/S, -Z/S, Y/S)`. The scale
cancels out of the field of view, so the framing matches without touching
the scene.

## What was actually wrong, and what fixed it

**1. The cone.** The torso ran unbroken to 1.65, tapering 1.38 → 0.42 over
0.33 of height. One continuous taper on a boxy torso *is* a lampshade. The
torso now stops at 1.43 with a short trapezius, and above it sit four
separate, narrow pieces: a neck (0.42 wide, 31% of the shoulders), a collar
band with a fold, a flat dark disc closing it, and turned-down collar points.

**2. The bow tie** — 0.43 wide, wings plus a knot, on the band. The single
highest-value detail: it is the one shape that says "dealer" in silhouette.

**3. The pale shelf.** After the cone went, a bright slab appeared across
the shoulders. It was not the torso's cap — it was the **trapezius in shirt
fabric**, because the jacket stopped at 1.30 and left the shoulders bare.
At a 31° down-angle that lit slope reads as a tabletop. `JACKET_TOP` 1.30 →
1.40 so the jacket covers the shoulders up to the collar, which is what a
suit jacket does.

**4. The orbs.** Rounding the shoulders with spheres produced two black
balls — a pauldron, not a deltoid. Shrinking and lowering them did not help:
a sphere at the shoulder shades as its own object and reads as a robot joint
at *any* size. They are gone. The shoulder is now the torso's own widest
rings (`w` is the X extent, so widening 1.02→1.28 broadens him side-to-side
only), and the sleeve emerges from below it the way an arm hangs.

**5. Blown specular.** Two pale tabs sat on the chest through several
iterations. They were not geometry — they were the lapel facets at roughness
0.26, which is patent leather. Jacket 0.34 → 0.46, lapel → 0.38. A material
value can masquerade as a modelling bug; check it before re-cutting geometry.

**6. Arms and shading.** Elbow joint spheres sit *on the pivot* and on the
PARENT bone, so the forearm swings about their centre and no gap can open —
that is what stops the arms reading as segmented tubes. Forearms taper
0.285 → 0.192; the cuff is wider than the sleeve it leaves, so it overhangs.
Smooth shading is set per polygon on the curved parts and left off n-gon
caps; because parts are separate objects until the final join their vertices
never merge, so every part boundary stays a hard edge by construction —
the same thing an auto-smooth angle buys.

**Retired:** the gold tie-line. A bow tie and a long tie together is nobody.
The gold accent is now the ϕ lapel pin alone.

## Martini

`Martini` (glass + olive + pick) and `MartiniLiquid` are **sibling nodes,
not parent and child** — verified in the glb JSON, both with no parent. That
is the requirement: the site tilts the glass and leaves the liquid level, so
they can be neither welded nor parented. Origin is at the glass base, which
is the point it rests on and therefore the point to tilt about. Glass and
liquid use Principled transmission, exported as `KHR_materials_transmission`
and `KHR_materials_ior`. `martini.py` is untouched — that still renders the
Cycles sprite.

## Verified

Re-import into a fresh scene, **and** by reading the glb JSON directly:
10 meshes, 22 nodes, skin `DealerRig`, 12 animations, extensions
`KHR_materials_transmission` / `KHR_materials_ior`, `Icosphere` absent.
The JSON check is the one that counts — this Blender adds a phantom
`Icosphere` on *import* that was never in the file.

## Still not right, if someone wants another pass

At 18.5% of frame width the arms still read a little tubular, and the collar
points are barely legible at that size. Both are cheap to improve — there
are 31k tris spare on him. Neither is what made him look like a robot.
