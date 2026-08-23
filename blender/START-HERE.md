# Suite 7 · blackjack assets — build this LIVE through blender-mcp

**Paste the "Prompt" section below into Claude Code.** Do not run these as
one-shot scripts and hope; drive Blender interactively through the MCP so
mistakes are visible in one step instead of after a crash.

## Setup (30 seconds)

1. Open Blender 5.2.
2. Press **N** in the 3D viewport → **BlenderMCP** tab → **Connect to Claude**.
   (Required every launch — it is not sticky.)
3. In a terminal, `cd` to this folder and run `claude`.
4. `/mcp` should list **blender** connected. Then paste the prompt.

---

## Prompt

> You have `blender-mcp` connected to a live Blender 5.2 (RTX 3060, OptiX).
> Build the Suite 7 blackjack assets described in `workorder/WORKORDER.md`.
> `workorder/GAME-MANIFEST.md` is the full vision — read it so nothing gets
> designed into a corner. `workorder/coin-handoff.md` is the coin's history.
>
> **Work interactively through the MCP.** After each step, inspect what you
> actually made (object names, dimensions, tri count, a viewport render) and
> correct it before moving on. Do not write a large script and run it blind —
> that is how the last two attempts died.
>
> Two modules in `blender/` are already written and syntax-checked — start
> from them rather than re-deriving:
>
> - **`s7_common.py`** — brand palette as linear RGB, `pbr()` glTF-safe
>   Principled materials, `glyph()` (text → mesh, ink-centred), `ngon()`,
>   `poly_curve()` (swept tube), `set_material()`, `tri_count()`, and `run()`
>   which writes a traceback file on failure.
> - **`s7_table.py`** — the half-moon table. `outline()` generates the
>   blackjack silhouette parametrically at any inset (the dealer notch is
>   CONCAVE, so offsetting by scaling collapses it — that's why it is
>   generated twice at different sizes rather than offset). `build_table()`
>   returns `Table` / `Shoe` / `ChipTray` / `DiscardTray`. `shoe_mouth()`
>   gives the point + heading `CardDeal` should pull from.
>
> Load them with:
> `import sys; sys.path.insert(0, r"<abs path>/blender"); import s7_common as C, s7_table as T`
>
> ### Order of work
> 1. `s7_table.build_table()` — then LOOK at it. Check proportions against a
>    real blackjack table, check the notch reads as a dealer position, check
>    tri count with `C.tri_count()`. Fix before continuing.
> 2. `Card7S` — 0.62 × 0.90 × 0.02, rounded, near-black face, gold border,
>    mirrored corner 7♠ indices, big centre spade, patterned back.
>    **Bevel gotcha:** a 0.05+ corner radius on a 0.02-thick slab clamps and
>    mangles. Bevel a ~0.20-thick slab, then scale Z down and apply.
> 3. `Chip7` — r 0.16 h 0.045, matching the approved toon coin (red body,
>    cream rim notches, big 7). `renders/chip_toon.png` is the approved look.
> 4. The four clips — `CardDeal`, `CardFlip`, `ChipToss`, `CardDiscard`.
>    Names are API; never rename. 30fps, start and end at rest, root motion on
>    the object, no camera/light keys inside clips.
>    `CardDeal` is the one that matters: start INSIDE the shoe slot, short
>    straight pull along the shoe's angle, release into a low spinning arc,
>    land with a few cm of skid and ~5° of residual rotation correcting to 0.
>    Make total Z rotation a whole number of turns so it lands square.
> 5. Export `out/table-assets.glb` — glTF, animations on, NLA strips named
>    after the actions, +Y up.
> 6. **Verify by re-import**: open a fresh scene, import the .glb, assert all
>    named objects and all clip names survived. Do not declare done otherwise.
> 7. Then `card7.py` → `card.png` (Priority 2 — the site's falling background
>    is staged and waiting on exactly this file).
>
> ### Hard constraints
> - Objects: `Table` `Shoe` `DiscardTray` `ChipTray` `Card7S` `Chip7`
> - Clips: `CardDeal` `CardFlip` `ChipToss` (+`CardDiscard` if cheap)
> - ≤ ~80k tris total · textures ≤2048² · **Principled BSDF only** (glTF PBR;
>   no Cycles-only node tricks, no Shader-to-RGB — that is EEVEE-only)
> - Palette: gold #e3c071 / #f7e8ac / #b8934a · crimson #b21d3b · warm
>   near-black #171207 · felt #0d0a06 · cream #F5F0F0 · **no pink/rose**
>
> ### Gotchas already paid for — do not rediscover
> 1. Applying a **Boolean or Bevel leaves an empty material slot at index 0**,
>    so everything renders white. Clear slots, append, set every polygon's
>    `material_index = 0`. `C.set_material()` does this.
> 2. Text `align_y='CENTER'` centres on the font **em-box, not the glyph ink**.
>    Convert to mesh, `origin_set(ORIGIN_GEOMETRY, BOUNDS)`, then place.
>    `C.glyph()` does this.
> 3. **Never** `matrix_parent_inverse = parent.matrix_world.inverted()` while
>    the parent is mid-animation — it cancels the child's placement. On the
>    coin this buried the "7" inside the chip at world z=0.002. Use identity.
> 4. Blender 5.2 gates image vs video formats: set
>    `image_settings.media_type` to `'VIDEO'` **before** `file_format='FFMPEG'`,
>    and back to `'IMAGE'` before `'PNG'`.
> 5. `bpy.ops.wm.read_homefile()` mid-script resets the UI and kills the run.
>    Each build clears its own scene instead.
> 6. Inverted-hull toon outlines rely on `use_backface_culling`, which is
>    **EEVEE-only**. They render as black blobs in Cycles and do not survive
>    glTF at all — keep them off anything destined for the .glb.
> 7. Fonts: `georgiab.ttf` (numerals/wordmarks), `seguisym.ttf` (♠♥♦♣ and ϕ —
>    Arial lacks them).
>
> ### Return
> `out/table-assets.glb`, `out/card.png`, plus `NOTES.md` recording what you
> changed, any traceback you hit, and anything you renamed (nothing in the
> contract may be renamed).

---

## What's already shipped

- `renders/chip_toon.png`, `renders/chip_real.png` — 1024² transparent coin
  sprites, both looks. `chip_toon.png` is the approved design language.
- On the user's machine: `Downloads\suite7\suite7 coin.blend` (toon) and
  `suite7 coin photoreal.blend`, heads face already rebranded DOJO → **7**.

## Not in scope this sprint

`cards-atlas.png` — the 52-face texture atlas. The manifest calls it "the
single most valuable texture in the project" but it is sprint 2, and the
work order does not ask for it. Do not start it without saying so.

## Other scripts in `blender/`

`card7.py` (P2) · `martini.py` (P3) · `chip.py` `toon2.py` `look.py`
`restore_real.py` `suite7_face.py` `render_sprites.py` (coin pipeline —
reference). `table_assets.py` is the ORIGINAL starting point for cards/chips/
clips; it has never completed a run, so treat it as a sketch, not a baseline.
Note `restore_real.py` must run before `look.py` — `look.py` only tunes an
existing Principled node, and `toon2.py` replaces those materials entirely.
