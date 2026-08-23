# Suite 7 — Blender kit

Scripts to rebrand and render the 3D assets on YOUR machine (RTX 3060 /
Blender 5.2, the same setup as the original DOJO coin). Run them from
Blender's **Scripting** tab (open the script, press ▶), or headless:

    blender "dojo gamble coin.blend" --background --python <script>.py

Run order:

| # | Script | Needs | Produces |
|---|--------|-------|----------|
| 1 | `suite7_face.py` | `dojo gamble coin.blend` open | Heads face DOJO → **7** (ϕ tails untouched). Save as `suite7 coin.blend` |
| 2 | `render_sprites.py` | the updated .blend open | `chip.png` (1024², transparent) → copy to `public/brand/chip.png` |
| 3 | `card7.py` | any empty/new scene | Builds a 7♠ card + renders `card.png` (transparent) → `public/brand/card.png` |
| 4 | `martini.py` (optional) | new scene | 3D martini glass + olive, renders `martini.png` (for a future 3D upgrade of the site's SVG martini) |
| 5 | `table_assets.py` | new scene | Card + chip models **with baked animations** (`CardDeal` / `CardFlip` / `ChipToss`) exported as `table-assets.glb` → copy to `public/brand/table-assets.glb` for the 3D blackjack table |

After copying the PNGs into `public/brand/`, flip the falling background to
the chips+cards mix by setting `textureUrl` on the two "deck" entries in
`components/ThreeBackground.tsx` (the file documents the exact lines) and
switching the dashboard to `variant="deck"`.

Known gotchas already baked into these scripts (learned the hard way on the
DOJO coin — see the original handoff):

- **Booleans add an empty material slot at index 0** → scripts clear slots and
  re-assign after any boolean apply.
- **Text `align_y='CENTER'` centers on the font em-box, not the glyph ink** →
  glyphs are converted to mesh, then `origin_set(ORIGIN_GEOMETRY, BOUNDS)`,
  then placed. Never trust raw text placement.
- Fonts: `C:\Windows\Fonts\georgiab.ttf` (numerals/wordmarks) and
  `C:\Windows\Fonts\seguisym.ttf` (ϕ and card suits — Arial lacks U+03D5/suits).
- Sprite renders set `film_transparent = True` and PNG RGBA.
- If you ever render video from a script: set
  `render.image_settings.media_type = 'VIDEO'` **before** `file_format = 'FFMPEG'`
  (Blender 5.2 enum quirk).
