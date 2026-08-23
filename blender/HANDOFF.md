# READ ME FIRST — handoff for the Blender-side Claude

You are working with Blender (via the Blender MCP) on assets for **Suite 7**,
a private trading-mentorship website (black + gold casino noir theme). The
website side is already built and waiting for the files you produce — the
site-side Claude wrote everything in this zip.

## What already exists on this machine

- Blender 5.2 LTS, RTX 3060 (Cycles on OptiX renders ~150 frames @512² in
  ~100s). Blender MCP add-on installed (N-panel → BlenderMCP → Connect).
- `C:\Users\vanqu\Downloads\dojo gamble coin.blend` — a finished 3D casino
  chip (the old "DOJO" brand): heads face says DOJO, tails face is a ϕ, with
  a seamless 150-frame coin-flip animation on an empty called `ChipRig`, and
  two switchable looks (anime cel / photoreal Cycles). Full technical notes
  are in `coin-handoff.md` in this zip — object names, geometry spec,
  animation timings, and the gotchas already solved. **Read it before
  touching the coin.**

## The brand changed: DOJO → Suite 7

Casino/prestige identity. Palette: gold `#e3c071`, highlight `#f7e8ac`,
deep gold `#b8934a`, crimson `#b21d3b`, warm near-black grounds
(`#171207` → `#000`), cream text. Serif (Georgia). The recurring motif is
the **7 of spades** and the ϕ mark.

## Your tasks, in order (scripts provided, adapt freely)

Run order and purpose are in `README.md`. Summary:

1. **`suite7_face.py`** — open the coin .blend; replace the DOJO heads text
   with a big lining **7** (ϕ tails stays). Save as `suite7 coin.blend`.
2. **`render_sprites.py`** — transparent 1024² sprite of the chip → `chip.png`.
3. **`card7.py`** — build + render the 7♠ playing card → `card.png`
   (transparent, portrait 708×1024).
4. **`table_assets.py`** — THE IMPORTANT ONE for the 3D blackjack game:
   card + chip models with three baked animation actions, exported as
   **`table-assets.glb`**.
5. **`martini.py`** — optional 3D martini render for later.

The scripts are starting points — you have live Blender access and can do
better (real materials, nicer bevels, richer animation easing). Improve
away, but the CONTRACT below must hold.

## THE CONTRACT (the website depends on these exactly)

- Animation clips in `table-assets.glb` must be named **`CardDeal`**,
  **`CardFlip`**, **`ChipToss`** (glTF exports NLA strips as clips — the
  scripts push each action onto an NLA track already).
- Output files, copied into the website repo at `public/brand/`:
  - `chip.png` (transparent RGBA)
  - `card.png` (transparent RGBA, portrait)
  - `table-assets.glb`
- Card proportions ≈ 0.62 × 0.90 (w×h); chip ≈ r 0.16, h 0.045 — the site's
  three.js scene (components/TableScene.tsx) sizes around these.
- Keep gold/crimson on warm-black; no pink/rose (the old brand color is dead).

## Where the outputs plug in (site side, already wired)

- `chip.png` + `card.png` → falling-background sprites
  (`components/ThreeBackground.tsx`, `textureUrl` fields on the "deck"
  variant).
- `table-assets.glb` → the 3D blackjack table
  (`components/TableScene.tsx`, factories `buildCardMesh` / `buildChipMesh`
  are the marked GLTFLoader swap-in seam).
- The updated coin (7/ϕ) also re-renders the Discord icon GIFs the same way
  the DOJO ones were made (see coin-handoff.md §4–5, scripts anim3/look/toon2
  in Downloads).

## Gotchas already learned (do not rediscover)

All in `coin-handoff.md` §6 — the big ones: boolean apply leaves an empty
material slot at index 0; text `align_y='CENTER'` centers on the em-box not
the ink (convert to mesh → origin BOUNDS); `media_type='VIDEO'` before
`file_format='FFMPEG'` in 5.2; fonts `georgiab.ttf` + `seguisym.ttf`
(Arial lacks ϕ and suits).
