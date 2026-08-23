# OVERNIGHT RUN — Suite 7 blackjack, the whole thing in one session

You (the Blender-side Claude) are running unattended. The human is asleep.
DO NOT wait for input at any point: make the reasonable call, write it in
`NOTES.md`, keep moving. Deliver as much of GAME-MANIFEST.md as the night
allows, in the phase order below — each phase ends with a SAVE + a
verification step, so a crash never loses more than one phase.

Ground rules
- HEADLESS or MCP commands only (`blender --background --python x.py`).
  Never drive the GUI. (Last session's own conclusion.)
- After EVERY phase: save the .blend (versioned: `s7_phase3.blend`), append
  to `NOTES.md` (what was built, decisions made, anything skipped), and if
  a script crashed, save the FULL traceback to `tracebacks/phaseN.txt` and
  move on — a later phase must never be blocked by an earlier cosmetic one.
- All names/budgets/colors come from GAME-MANIFEST.md §6 (the contract).
  Never rename contract items. Palette: gold #e3c071/#f7e8ac/#b8934a,
  crimson #b21d3b, near-black #171207, cream. Toon look is the approved
  style for textures/sprites.
- Time budget guide (RTX 3060): modeling phases are minutes; renders are
  cheap (~100s / 150 frames at 512²). If a phase drags past ~45 min of
  wall time, simplify it, note it, move on.

────────────────────────────────────────────────────────────────────────
PHASE 0 — smoke test (do this first, 5 min)
- Fresh scene → run `table_assets.py` AS-IS headless. It crashed last
  session with no traceback. Capture the traceback now, fix the cause
  (suspects: glTF exporter arg names, font paths, NLA API), and get ANY
  .glb exporting + re-importing cleanly before building more on top.
- Acceptance: re-import the .glb in a fresh scene; Card7S + Chip7 present,
  clips CardDeal/CardFlip/ChipToss present and play.

PHASE 1 — the Table environment
- Build per GAME-MANIFEST §1: `Table` (half-moon, felt + rail + gold trim,
  betting circle, felt print arcs incl. "INSURANCE PAYS 2 TO 1"),
  `Shoe` (own object, right side, card slot), `DiscardTray` (left),
  `ChipTray` (dealer side). Budgets: whole glb ≤80k tris, textures ≤4096²,
  Principled-only. Bake fancy shading into textures.
- Acceptance: tri count printed; re-import shows all four named objects.

PHASE 2 — hero card + chip, upgraded
- Improve `Card7S` (real bevel, crisp glyphs, patterned back) and `Chip7`
  (match the approved toon chip design language).
- Acceptance: silhouettes read at 128px in a test render.

PHASE 3 — the animation set (the night's centerpiece)
- Author ALL clips from GAME-MANIFEST §2 with its timing rules:
  CardDeal (true shoe pull: slide out of the slot → low spinning arc →
  skid-and-settle), CardFlip, ChipToss, CardDiscard, ChipPayout,
  ChipSweep, ShoeRefill, TableIntro.
- Push each action onto an NLA track named identically (export pattern is
  already in table_assets.py).
- Acceptance: export table-assets.glb; re-import; EVERY clip listed and
  playing; frame-1 pose == rest pose for each.

PHASE 4 — the 52-card atlas (most valuable texture in the project)
- `cards_atlas.py` is a starting point: renders every rank×suit face plus
  the back into cells and stitches `cards-atlas.png` (grid contract in
  GAME-MANIFEST §6: A..K columns, ♠♥♦♣ rows, back at row 5 col 1, uniform
  cells, ≤4096²). Toon style, gold ♠♣ / crimson ♥♦, lining digits.
- Acceptance: open the PNG; spot-check A♠, 10♦, back cell; no cell bleed.

PHASE 5 — 2D sprites
- `card.png` (7♠ portrait, toon, transparent 708×1024) via card7.py.
- Chip denominations: recolor Chip7 per manifest (25 cream / 100 gold /
  500 crimson) → chip-25.png, chip-100.png, chip-500.png (1024², toon).
- Acceptance: transparent backgrounds verified (no black squares).

PHASE 6 — bonuses, only if the night still has room
- martini.py → martini.png (Cycles glass; restore_real-style world trick).
- Re-render the Discord icon GIF from the suite7 coin (7/ϕ faces) using
  the existing anim3/toon2 pipeline → s7_icon_256.gif.
- A 3–4s hero loop of the coin at 1024² for the site.

PHASE 7 — package the return zip (NEVER skip, even after failures)
suite7-return.zip:
  table-assets.glb            ← phases 0–3
  cards-atlas.png             ← phase 4
  card.png, chip-*.png        ← phase 5
  (bonuses if made)
  NOTES.md                    ← per-phase log, decisions, deviations
  tracebacks/*.txt            ← every crash, even fixed ones
  s7_phase*.blend             ← optional but appreciated
Partial delivery beats no delivery: whatever exists at end of night goes
in the zip. The website Claude debugs from NOTES + tracebacks.

────────────────────────────────────────────────────────────────────────
Decision policy while unattended
- Aesthetic judgment calls: match the approved toon chip + the palette;
  when torn, pick the more UNDERSTATED option (quiet luxury, not cartoon).
- Technical blockers: simplify rather than stall (e.g. cloth normals too
  heavy → plain dark felt with a noise bump; glTF refuses a feature →
  bake it). Log every simplification.
- NEVER rename anything in GAME-MANIFEST §6. If a contract item is truly
  impossible, ship without it and flag it at the TOP of NOTES.md.
