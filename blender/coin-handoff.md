# DOJO Gamble Coin — project handoff

3D casino chip built in Blender for a Discord server icon, now heading into a website.
Everything below was produced in a prior session; this file is the complete state.

---

## 1. Files (all currently in `C:\Users\vanqu\Downloads\`)

| File | What it is |
|---|---|
| `dojo gamble coin.blend` | **The master scene.** Saved in the anime/cel-shaded state. |
| `gu_icon_dojo_256.gif` | Final Discord icon, 256px, 1.8 MB — the one to upload |
| `gu_icon_dojo_512.gif` | Same, 512px, 5.9 MB |
| `gu_icon_dojo0001-0150.mp4` | Source render of the final animation |
| `gu_icon_toon_256.gif` | Anime version with the old GAMBLERS/UNIVERSITY wordmark |
| `gu_icon_hq_256.gif` | **Photoreal** Cycles version (old wordmark) |
| `chip.py` | Builds the chip geometry from scratch |
| `anim3.py` | Bakes the 150-frame flip animation |
| `look.py` | Applies the **photoreal Cycles** look |
| `toon2.py` | Applies the **anime cel-shaded** look |
| `dojo.py` | Swaps heads face to DOJO + sets black background |

Re-running a look script switches the .blend between the two styles.

---

## 2. Blender + MCP setup (already working)

Blender **5.2.0 LTS**. GPU is an **RTX 3060**, Cycles runs on **OptiX** — 150 frames at
512x512 renders in ~100 seconds, so quality is cheap here.

`blender-mcp` is registered in **`C:\Users\vanqu\.claude.json`** under `mcpServers`:

```json
"blender": {
  "type": "stdio",
  "command": "C:\\Users\\vanqu\\.local\\bin\\blender-mcp.exe",
  "args": [], "env": {}
}
```

> **Important:** this is NOT `%APPDATA%\Claude\claude_desktop_config.json`. That path is
> from the old standalone Claude Desktop app and is ignored on this machine. A stray unused
> config file may still exist there; it does nothing.

To use it: open Blender, press **N** in the viewport, open the **BlenderMCP** tab, click
**Connect to Claude**. That click is required every time Blender launches.

---

## 3. The model

Object names in the .blend:

- `Chip` — main body
- `Inserts` — the 8 white edge notches
- `Txt_DOJO` — heads face wordmark
- `Txt.002` — tails face ϕ (U+03D5, Greek phi symbol)
- `ChipRig` — empty at origin; **everything is parented to this and it carries the animation**
- `Sun`, `Camera`

Geometry spec:

- Radius **1.0**, thickness **0.17**
- **8** edge notches, cut with booleans, filled with cream inserts trimmed to r=0.997
- Both faces recessed 0.015 deep at r=0.80, leaving a raised rim ring
- Bevel 0.010, 3 segments, 35° angle limit
- Text sits on the recessed face at z = ±0.070, extruded 0.014

Camera: `(0, -2.23, 3.17)`, rot X `atan2(2.23, 3.17)`, 62mm — square 512x512 framing.
Discord crops icons to a circle, so the chip deliberately fills ~89% of the square.

---

## 4. The animation

150 frames @ 30fps = **5.0s**, seamless loop, baked one keyframe per frame onto `ChipRig`.

| Frames | Phase |
|---|---|
| 0–16 | hold on DOJO |
| 16–66 | flip (2.5 turns) |
| 66–86 | hold on ϕ |
| 86–136 | flip (2.5 turns) |
| 136–149 | hold on DOJO |

- Rotation X totals **10π** (5 full turns) so frame 150 == frame 1. Rotation Z totals **4π**.
- Flip easing is `1-(1-t)^3` (ease-out cubic) — fast launch, bleeding off speed like a real toss.
- The chip tumbles about world X *while* spinning about its own face-normal (Z). That
  combination is what makes it read as a coin flip rather than a turntable.
- Settle wobble: `0.15 * exp(-0.26n) * sin(0.72n)`, damped to nothing before the loop point.
- Verified loop seam: first vs last frame differ by 0.9/255 (GIF dither noise only).

---

## 5. Two looks

### Anime / cel (current state of the .blend) — `toon2.py`
- **EEVEE** (Shader-to-RGB only works there, and it's what does the flat banding)
- Materials: Diffuse → ShaderToRGB → RGBtoBW → **ColorRamp set to CONSTANT** interpolation,
  3 flat bands at thresholds 0.30 / 0.72 → Emission
- **One hard Sun**, energy 3.14, angle 0 — parallel light means banding follows surface
  normals rather than distance falloff
- Outlines: inverted hull — Solidify, flip normals, offset 1.0, thickness 0.038 (chip),
  black emission material with `use_backface_culling = True`
- View transform **Standard** (AgX would mush the flat bands)
- Motion blur **off**

### Photoreal — `look.py`
- **Cycles** on OptiX, 80–220 samples, adaptive, OptiX denoiser
- World uses a **Light Path → Is Camera Ray** mix: black to the camera, bright grey to
  reflections. This is what makes the gold read as metal — a metal on a black background
  has nothing to reflect and looks like flat plastic.
- 3 area softboxes, clearcoat on the chip body
- View transform AgX Punchy, motion blur shutter 0.42

---

## 6. Gotchas already hit — don't rediscover these

1. **Blender 5.2 video output**: you must set `render.image_settings.media_type = 'VIDEO'`
   *before* `file_format = 'FFMPEG'`, or FFMPEG isn't in the enum and it throws.
2. **Applying a Boolean adds an empty material slot at index 0**, so all faces render with
   no material (white). After booleans: clear slots, append the real material, set every
   polygon's `material_index = 0`.
3. **The outline shell casts shadows** and will put the entire model in shadow. Cel shading
   needs `eevee.use_shadows = False` anyway.
4. **Flat faces + hard specular = full-face white flash.** At one angle the whole flat face
   crosses the highlight threshold at once. Body specular is disabled for this reason.
5. **`align_y='CENTER'` centers on the font em-box, not the glyph ink** — that's why the ϕ
   looked off-center. Fix: convert to mesh, then
   `origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')`, then place at (0,0,z).
6. Fonts used: `georgiab.ttf` (DOJO), `seguisym.ttf` (ϕ — plain Arial lacks U+03D5).
   Text is already converted to mesh, so the .blend has no font dependency.
7. On a pitch-black background the near-black outline vanishes at the silhouette. Lift the
   background to ~`#0A0A0C` if you want the outline visible all the way around.

---

## 7. Discord icon notes

- Animated server icons require **Boost Level 1**
- Icons display at **128px** — use the 256 GIF, the 512 buys nothing and is 3x the size
- Server Settings → Overview → icon

---

## 8. Likely next steps for the website

Assets that would need rendering out of this scene:

- Transparent-background PNG/WebP of the chip (set `render.film_transparent = True`)
- A hero loop at higher res (1024+) — cheap on this GPU
- Alternate denominations: duplicate, recolor `ChipCrimson`, re-render
- Chip stack / physics shots (rigid body) — discussed but not built
- Both looks are one script away, so the site can use photoreal or anime consistently

Open design question: at 128px the old GAMBLERS/UNIVERSITY wordmark was illegible, which is
why it was replaced with a single large **DOJO**. Keep that constraint in mind for any new
face designs.
