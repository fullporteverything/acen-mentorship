# WORK ORDER · SPRINT 2 — the dealer, the deck, the bigger table

Sprint 1 shipped and is LIVE on the site (table-assets.glb + card.png +
denomination chips — great work; the exact-endpoint clips integrated
cleanly). BUILD-NOTES.md's gotchas (origin_set silently failing over MCP,
slotted actions, stale obj.dimensions) are now canon — keep working the
same way: live over MCP, measure after every step, headless-safe code.

Deliverables append to the SAME table-assets.glb (or a second
dealer-assets.glb if file size demands — say so in NOTES). Same rules:
Principled-only, names are API, nothing existing gets renamed, tri budget
now ≤140k total across files, textures ≤2048².

── PRIORITY 1 · THE DEALER ────────────────────────────────────────────────
A faceless dealer, **neck-down**, standing behind the dealer notch. The
site frames the table from the player side at ~41° pitch, so the dealer is
seen chest-to-waist above the rail — spend the detail there.

- Object `Dealer`: torso + arms + hands, cut off cleanly at the neck (flat
  cap or collar shadow — NO head, it's the brand's faceless House).
  Outfit: black suit **vest** with subtle sheen over a crisp near-black
  shirt (sleeves rolled OR full sleeves with gold cufflinks), a thin gold
  tie-line or ϕ lapel pin as the single accent. Hands matter most —
  simple stylized gloves (black) are acceptable and dodge skin-tone work.
  Anchor: standing centered in the dealer notch, hands resting at the
  felt edge near the Shoe/ChipTray. ≤35k tris.
- Clips (30fps, start/end at rest, root motion, names exact):
  - `DealerIdle` (~90–150f, LOOPING — flag loop in NOTES): subtle breathing
    sway + occasional finger tap on the felt. Must loop seamlessly.
  - `DealerDeal` (~40f): right hand reaches to the Shoe, pulls, and sweeps
    toward the table center — timed so the site can fire it WITH CardDeal
    (card leaves the shoe as the hand sweeps past it).
  - `DealerFlip` (~20f): a short wrist flick toward the hole-card spot,
    pairs with CardFlip.
  - `DealerSweep` (~30f): open-palm drag toward the ChipTray, pairs with
    the house collecting a lost bet.
  Simple armature is fine; export skinned. If IK setup fights the clock,
  bake to FK — the site only plays clips.

── PRIORITY 2 · THE 52-CARD ATLAS ─────────────────────────────────────────
`cards-atlas.png` per GAME-MANIFEST §6: 13 columns (A,2..10,J,Q,K) ×
4 rows (♠,♥,♦,♣), back at row 5 col 1, uniform cells, ≤4096², toon style
matching card.png exactly (near-black face, gold border, gold ♠♣ /
crimson ♥♦, lining digits, mirrored indices). cards_atlas.py is a starter;
its glyph work must use the no-bpy.ops path from s7_common. This unlocks
real rank faces in the 3D game — the site UV-maps one card mesh per cell.

── PRIORITY 3 · THE TABLE GROWS ───────────────────────────────────────────
Multiplayer arrives later; author it now so the site just swaps meshes:
- `Table5` — a wider variant (~7.4 × 3.9) of the SAME design with FIVE
  subtle betting circles fanned along the player arc (center one identical
  to Table's). Same felt print. Reuse s7_table.outline with wider params.
- Keep the original `Table` untouched — the site picks per player count.

── PRIORITY 4 · SMALL FIXES (cheap, batch at the end) ─────────────────────
- ChipTray: cut the real recess into the felt (the boolean; remember the
  material-slot gotcha) OR keep proud if it fights — cosmetic.
- The dealer-row nudge from sprint 1 NOTES (cards can graze the ChipTray
  footprint by a few hundredths): shift the authored CardDeal end pose /
  row anchor +0.05y if trivial, else note it.
- `martini.png` if the night has room (optional).

── RETURN ─────────────────────────────────────────────────────────────────
Zip: updated .glb(s) · cards-atlas.png · any PNGs · NOTES.md (what changed,
loop flags, tracebacks, any deviation) · updated s7_*.py modules.
Contract additions: objects `Dealer` `Table5`; clips `DealerIdle`
`DealerDeal` `DealerFlip` `DealerSweep`. Everything from sprint 1 keeps
its name and stays in the file.
