"""s7_table.py — the blackjack table environment.

Builds four separately-named objects (names are the site contract):
    Table · Shoe · DiscardTray · ChipTray

Table space: x in [-3.0, 3.0], y in [-1.75, +1.75]  (6.0 x 3.5 units).
Player side is -Y (nearest the site camera), dealer stands at +Y in the
half-moon notch. Playing surface sits at z = SURFACE_Z.

Shape note: the outline is generated parametrically at two different
inset sizes rather than offset after the fact — the dealer notch is
CONCAVE, so a naive scale-toward-centre would collapse it.

Run standalone to build just the environment:
    blender --background --python s7_table.py
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C

# ── dimensions ───────────────────────────────────────────────────────────
HALF_W = 3.0          # -> 6.0 wide
DEPTH = 3.5           # -> 3.5 deep
Y_BACK = 1.75         # dealer edge
NOTCH_R = 0.95        # dealer half-moon cutout
RAIL_W = 0.26         # padded rail band width
SLAB_H = 0.16         # table body thickness
SURFACE_Z = 0.008     # top of the felt
CARD_REST_Z = 0.020   # where a laid card sits
BET_CIRCLE = (0.0, -0.60, 0.35)   # x, y, radius
FELT_PRINT = True     # the printed arcs (geometry; set False to save tris)

ARC_SEG = 18          # segments across the dealer notch
FRONT_SEG = 84        # segments around the front arc


def outline(half_w, depth, y_back, notch_r):
    """Half-moon blackjack outline, CCW, starting at the back-right corner."""
    pts = [(half_w, y_back)]
    for i in range(ARC_SEG + 1):                      # dealer notch (concave)
        t = math.pi * i / ARC_SEG
        pts.append((notch_r * math.cos(t), y_back - notch_r * math.sin(t)))
    pts.append((-half_w, y_back))
    for i in range(1, FRONT_SEG):                     # elliptical player arc
        t = math.pi + math.pi * i / FRONT_SEG
        pts.append((half_w * math.cos(t), y_back + depth * math.sin(t)))
    return pts


def slab(name, pts, top_z, thickness, mat):
    ob = C.ngon(name, pts, z=top_z)
    md = ob.modifiers.new("solid", "SOLIDIFY")
    md.thickness = thickness
    md.offset = -1.0            # extrude downward, keep top face at top_z
    C.apply_mod(ob, md)
    C.set_material(ob, mat)
    return ob


def tube(name, pts, z, depth, mat, res=4):
    ob = C.poly_curve(name, pts, z=z, depth=depth, resolution=res)
    ob = C.to_mesh(ob)
    ob.name = name
    C.set_material(ob, mat)
    return ob


def arc_text(body, radius, cy, char_h, mat, center_deg=0.0, spacing_deg=None,
             name="print"):
    """Letters placed one by one around an arc.

    Blender can bend text with follow_curve, but controlling WHICH part of
    the curve the text lands on is fiddly and fails quietly. Placing each
    glyph at an explicit angle is a few more lines and completely
    deterministic. Angle is measured from straight-down (-Y)."""
    body = body.upper()
    n = len(body)
    if spacing_deg is None:
        spacing_deg = math.degrees(char_h * 0.92 / radius)
    start = center_deg - spacing_deg * (n - 1) / 2.0
    parts = []
    for i, ch in enumerate(body):
        if ch == " ":
            continue
        a = math.radians(start + spacing_deg * i)
        g = C.glyph(ch, C.GEORGIA, f"{name}_{i}", char_h, mat,
                    extrude=0.0015, resolution_u=1)
        g.location = (radius * math.sin(a), cy - radius * math.cos(a),
                      SURFACE_Z + 0.002)
        g.rotation_euler = (0.0, 0.0, -a)
        parts.append(g)
    return C.join(parts, name) if parts else None


def build_shoe():
    """Dealer's shoe, right side: angled body, gold lip, dark card slot."""
    mat_body = C.pbr("S7_ShoeBody", C.NEARBLACK, 0.0, 0.42)
    mat_gold = C.pbr("S7_ShoeLip", C.GOLD, 0.85, 0.28)
    mat_slot = C.pbr("S7_ShoeSlot", C.srgb("#050403"), 0.0, 0.70)

    parts = []
    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.active_object
    body.scale = (0.44, 0.34, 0.30)
    bpy.ops.object.transform_apply(scale=True)
    bev = body.modifiers.new("b", "BEVEL")
    bev.width = 0.02
    bev.segments = 2
    bev.limit_method = "ANGLE"
    C.apply_mod(body, bev)
    C.set_material(body, mat_body)
    parts.append(body)

    # gold lip across the mouth (player-facing lower edge)
    bpy.ops.mesh.primitive_cube_add(size=1)
    lip = bpy.context.active_object
    lip.scale = (0.44, 0.045, 0.035)
    lip.location = (0.0, -0.35, -0.11)
    bpy.ops.object.transform_apply(scale=True)
    C.set_material(lip, mat_gold)
    parts.append(lip)

    # the slot the card is pulled from
    bpy.ops.mesh.primitive_cube_add(size=1)
    slot = bpy.context.active_object
    slot.scale = (0.33, 0.03, 0.016)
    slot.location = (0.0, -0.34, -0.055)
    bpy.ops.object.transform_apply(scale=True)
    C.set_material(slot, mat_slot)
    parts.append(slot)

    shoe = C.join(parts, "Shoe")
    shoe.rotation_euler = (math.radians(-16.0), 0.0, math.radians(-26.0))
    shoe.location = (1.78, 0.92, SURFACE_Z + 0.15)
    return shoe


def build_tray(name, w, d, rows, mat_body, mat_gold):
    """Open tray: base plate + perimeter walls + row dividers (no booleans —
    dividers read as slots without any boolean/material-slot risk)."""
    parts = []
    bpy.ops.mesh.primitive_cube_add(size=1)
    base = bpy.context.active_object
    base.scale = (w, d, 0.030)
    bpy.ops.object.transform_apply(scale=True)
    C.set_material(base, mat_body)
    parts.append(base)

    wall_h = 0.075
    for sx, sy, sz, lx, ly in (
        (0.0, d / 2, wall_h / 2, w, 0.028),
        (0.0, -d / 2, wall_h / 2, w, 0.028),
        (w / 2, 0.0, wall_h / 2, 0.028, d),
        (-w / 2, 0.0, wall_h / 2, 0.028, d),
    ):
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = (lx, ly, wall_h)
        o.location = (sx, sy, sz)
        bpy.ops.object.transform_apply(scale=True)
        C.set_material(o, mat_gold)
        parts.append(o)

    for i in range(1, rows):
        x = -w / 2 + (w / rows) * i
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = (0.020, d, wall_h * 0.8)
        o.location = (x, 0.0, wall_h * 0.4)
        bpy.ops.object.transform_apply(scale=True)
        C.set_material(o, mat_body)
        parts.append(o)

    return C.join(parts, name)


def build_table():
    """Returns {'Table','Shoe','ChipTray','DiscardTray'}."""
    mat_felt = C.pbr("S7_Felt", C.FELT, 0.0, 0.92)
    mat_rail = C.pbr("S7_Rail", C.srgb("#231a10"), 0.0, 0.55)
    mat_gold = C.pbr("S7_TableGold", C.GOLD, 0.85, 0.26)
    mat_golddk = C.pbr("S7_TableGoldDk", C.GOLD_DK, 0.85, 0.34)
    mat_print = C.pbr("S7_FeltPrint", C.GOLD_DK, 0.30, 0.60)

    outer = outline(HALF_W, DEPTH, Y_BACK, NOTCH_R)
    inner = outline(HALF_W - RAIL_W, DEPTH - RAIL_W,
                    Y_BACK - RAIL_W, NOTCH_R + RAIL_W)
    railmid = outline(HALF_W - RAIL_W / 2, DEPTH - RAIL_W / 2,
                      Y_BACK - RAIL_W / 2, NOTCH_R + RAIL_W / 2)

    parts = []
    parts.append(slab("TableBody", outer, 0.0, SLAB_H, mat_rail))
    parts.append(slab("TableFelt", inner, SURFACE_Z, 0.012, mat_felt))
    parts.append(tube("TableTrim", inner, SURFACE_Z + 0.004, 0.010, mat_gold))
    parts.append(tube("TableRail", railmid, 0.012, RAIL_W * 0.55, mat_rail, res=5))

    bx, by, br = BET_CIRCLE
    circle = [(bx + br * math.cos(2 * math.pi * i / 64),
               by + br * math.sin(2 * math.pi * i / 64)) for i in range(64)]
    parts.append(tube("BetCircle", circle, SURFACE_Z + 0.003, 0.011, mat_gold))

    if FELT_PRINT:
        wm = C.glyph("SUITE 7", C.GEORGIA, "FeltWordmark", 0.20, mat_print,
                     extrude=0.0015, resolution_u=1)
        wm.location = (0.0, 0.28, SURFACE_Z + 0.002)
        parts.append(wm)
        for txt, rad, size in (
            ("BLACKJACK PAYS 3 TO 2", 1.22, 0.105),
            ("DEALER STANDS ON ALL 17s", 1.52, 0.095),
            ("INSURANCE PAYS 2 TO 1", 0.74, 0.075),
        ):
            a = arc_text(txt, rad, 0.62, size, mat_print,
                         name="FeltPrint_" + txt.split()[0])
            if a:
                parts.append(a)

    table = C.join(parts, "Table")

    shoe = build_shoe()
    chip = build_tray("ChipTray", 1.55, 0.40, 4, mat_rail, mat_golddk)
    chip.location = (0.0, 1.08, SURFACE_Z + 0.016)
    disc = build_tray("DiscardTray", 0.52, 0.40, 1, mat_rail, mat_golddk)
    disc.location = (-1.80, 0.95, SURFACE_Z + 0.016)

    return {"Table": table, "Shoe": shoe, "ChipTray": chip, "DiscardTray": disc}


def shoe_mouth():
    """World point + heading the CardDeal clip pulls a card from."""
    return (1.55, 0.55, SURFACE_Z + 0.10), math.radians(-26.0)


def _main():
    C.clear_scene()
    objs = build_table()
    print("built:", sorted(objs))
    print("tris:", C.tri_count())
    bpy.ops.wm.save_as_mainfile(filepath=C.outpath("s7_table.blend"))


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_table"))
