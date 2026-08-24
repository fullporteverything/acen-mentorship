"""s7_table.py -- the blackjack table environment.

Builds four separately-named objects (names are the site contract):
    Table . Shoe . DiscardTray . ChipTray

Table space: x in [-3.0, 3.0], y in [-1.75, +1.75]  (6.0 x 3.5 units).
Player side is -Y (nearest the site camera), dealer stands at +Y in the
half-moon notch. Playing surface sits at z = SURFACE_Z.

Shape note: the outline is generated parametrically at two different
inset sizes rather than offset after the fact -- the dealer notch is
CONCAVE, so a naive scale-toward-centre would collapse it.

INSET MATH (fixed 2026-08-23): the silhouette is parameterised by both a
straight back edge (y_back) AND a front half-ellipse whose semi-minor axis
(depth) is measured from that same y. Reducing BOTH by the inset cancels
out at the front -- (y_back-k) - (depth-k) == y_back-depth -- which is why
the felt reached the raw table edge and the rail tube hung 0.14 past it.
The correct inset is y_back-k with depth-2k.  The dealer scallop is an
ellipse whose CENTRE does not move under inset; only its radii grow, so it
is passed separately (notch_cy) and clamped to the back edge.

Run standalone to build just the environment:
    blender --background --python s7_table.py
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C

# -- dimensions ----------------------------------------------------------
HALF_W = 3.0          # -> 6.0 wide
DEPTH = 3.5           # -> 3.5 deep
Y_BACK = 1.75         # dealer edge
NOTCH_RX = 1.30       # dealer scallop: WIDE and SHALLOW, like the real thing.
NOTCH_RY = 0.52       # (was a 0.95 half-circle, which ate the chip tray's felt)
NOTCH_R = NOTCH_RY    # back-compat alias for older scripts
RAIL_W = 0.26         # padded rail band width
SLAB_H = 0.16         # table body thickness
SURFACE_Z = 0.008     # top of the felt
CARD_REST_Z = 0.020   # where a laid card sits
BET_CIRCLE = (0.0, -0.90, 0.34)   # x, y, radius
FELT_PRINT = True     # the printed arcs (geometry; set False to save tris)

# Felt printing. All three arcs share ONE centre well above the table so
# they come out concentric and gently curved, and their radii are NESTED so
# they cannot bunch. A long string on a small radius climbs steeply --
# "BLACKJACK PAYS 3 TO 2" on the old r=1.22 swept 91 deg and rose 0.36.
PRINT_CY = 3.10
FELT_ROWS = (
    # (text,                          y on the centreline, char height)
    ("BLACKJACK PAYS 3 TO 2",          0.06,  0.140),
    ("DEALER MUST STAND ON ALL 17s",  -0.19,  0.098),
    ("INSURANCE PAYS 2 TO 1",         -0.42,  0.088),   # nearest the player
)
WORDMARK = (0.0, 0.37, 0.185)         # x, y, cap height
CHIPTRAY_Y = 0.72
CHIPTRAY_RECESS = 0.050   # depth of the pocket the chip rack sits down into
DISCARD_XY = (-1.95, 1.15)
SHOE_XY = (1.92, 1.10)
SHOE_YAW = math.radians(-26.0)
SHOE_TILT = math.radians(-16.0)

ARC_SEG = 22          # segments across the dealer scallop
FRONT_SEG = 84        # segments around the front arc


def outline(half_w, depth, y_back, notch_rx, notch_ry, notch_cy=None):
    """Half-moon blackjack outline, from the back-right corner.

    half_w/depth  front half-ellipse semi-axes (depth measured from y_back)
    y_back        the straight back edge
    notch_rx/ry   dealer scallop radii
    notch_cy      scallop centre; defaults to y_back. Under inset this stays
                  put while y_back moves, so the scallop is clamped to the
                  back edge rather than poking above it.
    """
    if notch_cy is None:
        notch_cy = y_back
    pts = [(half_w, y_back)]
    for i in range(ARC_SEG + 1):                      # dealer scallop (concave)
        t = math.pi * i / ARC_SEG
        y = notch_cy - notch_ry * math.sin(t)
        pts.append((notch_rx * math.cos(t), min(y, y_back)))
    pts.append((-half_w, y_back))
    for i in range(1, FRONT_SEG):                     # elliptical player arc
        t = math.pi + math.pi * i / FRONT_SEG
        pts.append((half_w * math.cos(t), y_back + depth * math.sin(t)))
    return pts


def outlines():
    """outer / felt / rail-centreline, each generated at its own inset."""
    k = RAIL_W
    outer = outline(HALF_W, DEPTH, Y_BACK, NOTCH_RX, NOTCH_RY)
    inner = outline(HALF_W - k, DEPTH - 2 * k, Y_BACK - k,
                    NOTCH_RX + k, NOTCH_RY + k, notch_cy=Y_BACK)
    railmid = outline(HALF_W - k / 2, DEPTH - k, Y_BACK - k / 2,
                      NOTCH_RX + k / 2, NOTCH_RY + k / 2, notch_cy=Y_BACK)
    return outer, inner, railmid


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


def _text_mesh(body, font_path, name, size, mat=None, extrude=0.0015, res=1):
    """Text -> mesh at an EXPLICIT em size, origin ON THE BASELINE.

    Deliberately NOT C.glyph. C.glyph normalises every glyph's ink box to
    one height, which is right for a lone centred symbol but wrong for a
    row of type: Georgia ships OLD-STYLE figures (3 4 5 7 9 descend below
    the baseline, 1 and 2 are x-height), so normalising makes a '3' as tall
    as a 'B' and then centres it on its own ink -- which is exactly what
    made 'PAYS 3 TO 2' wander off the line. One shared em size plus one
    shared baseline keeps a row on a row.
    """
    cu = bpy.data.curves.new(name + "_cu", type="FONT")
    cu.body = body
    if font_path and os.path.isfile(font_path):
        try:
            cu.font = bpy.data.fonts.load(font_path)
        except RuntimeError:
            print("WARN: could not load font", font_path)
    else:
        print("WARN: font missing:", font_path)
    cu.size = size
    cu.align_x = "LEFT"
    # Blender 5.2 has no plain 'BASELINE'; the enum is
    # ('TOP','TOP_BASELINE','CENTER','BOTTOM_BASELINE','BOTTOM').
    # For single-line text TOP_BASELINE and BOTTOM_BASELINE coincide.
    cu.align_y = "BOTTOM_BASELINE"
    cu.extrude = extrude
    cu.resolution_u = res
    ob = C.link(bpy.data.objects.new(name, cu))
    ob = C.to_mesh(ob)
    ob.name = name
    if mat is not None:
        C.set_material(ob, mat)
    return ob


_CAPFRAC = {}


def _cap_fraction(font_path):
    """Cap height as a fraction of em, measured off the font itself so the
    requested char_h means CAP HEIGHT rather than 'whatever this glyph's
    ink happened to be'."""
    if font_path not in _CAPFRAC:
        probe = _text_mesh("H", font_path, "_capprobe", 1.0)
        f = probe.dimensions.y
        bpy.data.objects.remove(probe, do_unlink=True)
        _CAPFRAC[font_path] = f if f > 1e-6 else 0.70
    return _CAPFRAC[font_path]


def _ink_x(ob):
    xs = [v[0] for v in ob.bound_box]
    return min(xs), max(xs)


def arc_text(body, radius, cy, char_h, mat, center_deg=0.0, tracking=0.13,
             font=None, name="print"):
    """A row of type set along an arc centred at (0, cy), reading from -Y.

    Blender can bend text with follow_curve, but controlling WHICH part of
    the curve the text lands on is fiddly and fails quietly. Placing each
    glyph at an explicit arc length is a few more lines and completely
    deterministic.

    Two things this gets right that the fixed-pitch version did not:
      * advance is PROPORTIONAL -- each glyph steps by its own ink width
        plus tracking, so 'BLACKJACK' does not bunch while '3 TO 2' rattles.
      * the arc carries the BASELINE, not the glyph centres, so old-style
        figures hang below it the way the typeface intends.

    Glyph i sits below the centre, so a reader at -Y wants its local +Y to
    point back TOWARDS the centre: rotation about Z is +a. It used to be
    -a, which mirrored the lean either side of centre and made the row read
    as splayed/upside-down.
    """
    font = font or C.GEORGIA
    body = body.upper()
    size = char_h / _cap_fraction(font)
    space_adv = size * 0.30
    track = char_h * tracking

    items = []                                  # (obj|None, advance, ink cx)
    for i, ch in enumerate(body):
        if ch == " ":
            items.append((None, space_adv, 0.0))
            continue
        g = _text_mesh(ch, font, "%s_%d" % (name, i), size, mat)
        x0, x1 = _ink_x(g)
        items.append((g, (x1 - x0) + track, (x0 + x1) / 2.0))

    total = sum(a for _, a, _ in items)
    r = radius + char_h * 0.5      # baseline sits half a cap OUTSIDE centre,
    s = -total / 2.0               # so the row's optical centre lands on y
    parts = []
    for g, adv, cx in items:
        if g is not None:
            a = math.radians(center_deg) + (s + (adv - track) / 2.0) / r
            # step back along the tangent by the glyph's own ink centre
            g.location = (r * math.sin(a) - cx * math.cos(a),
                          cy - r * math.cos(a) - cx * math.sin(a),
                          SURFACE_Z + 0.002)
            g.rotation_euler = (0.0, 0.0, a)
            parts.append(g)
        s += adv
    return C.join(parts, name) if parts else None


def flat_text(body, x, y, char_h, mat, font=None, name="flat", tracking=0.0):
    """Straight centred row, same baseline/cap-height rules as arc_text."""
    font = font or C.GEORGIA
    g = _text_mesh(body, font, name, char_h / _cap_fraction(font), mat)
    x0, x1 = _ink_x(g)
    g.location = (x - (x0 + x1) / 2.0, y - char_h * 0.5, SURFACE_Z + 0.002)
    return g


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
    shoe.rotation_euler = (SHOE_TILT, 0.0, SHOE_YAW)
    shoe.location = (SHOE_XY[0], SHOE_XY[1], 0.0)
    # sit it ON the felt: the -16 deg tilt drops a corner well below the
    # object origin, so measure the transformed bbox instead of guessing.
    bpy.context.view_layer.update()
    zmin = min((shoe.matrix_world @ v.co).z for v in shoe.data.vertices)
    shoe.location.z = SURFACE_Z - zmin
    bpy.context.view_layer.update()
    return shoe


def build_tray(name, w, d, rows, mat_body, mat_gold):
    """Open tray: base plate + perimeter walls + row dividers (no booleans --
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


def felt_edge_y(x=0.0):
    """y of the felt's front edge at a given x -- handy for layout checks."""
    k = RAIL_W
    hw, dp, yb = HALF_W - k, DEPTH - 2 * k, Y_BACK - k
    if abs(x) >= hw:
        return yb
    return yb - dp * math.sqrt(1.0 - (x / hw) ** 2)


def notch_edge_y(x=0.0):
    """y of the felt's dealer-side edge at a given x."""
    k = RAIL_W
    rx, ry = NOTCH_RX + k, NOTCH_RY + k
    if abs(x) >= rx:
        return Y_BACK - k
    return min(Y_BACK - k, Y_BACK - ry * math.sqrt(1.0 - (x / rx) ** 2))


def cut_tray_recess(table, mat_pocket):
    """Boolean a real pocket in the table so ChipTray sits IN the felt.

    BOOLEAN GOTCHA, handled carefully. Applying a boolean leaves an empty
    material slot at index 0 and everything renders white. The usual fix --
    C.set_material -- would be WRONG here: Table carries five materials and
    that helper forces every polygon onto one, which would flatten the felt,
    rail, trim and print into a single colour. So instead the cutter is
    given a real material and transferred, and build_table asserts
    afterwards that no slot is empty and no polygon points at one.
    """
    w, d = 1.630, 0.480
    top = SURFACE_Z + 0.040
    bottom = SURFACE_Z - CHIPTRAY_RECESS
    bpy.ops.mesh.primitive_cube_add(size=1)
    cut = bpy.context.active_object
    cut.name = "TrayCutter"
    cut.scale = (w, d, top - bottom)
    cut.location = (0.0, CHIPTRAY_Y, (top + bottom) / 2.0)
    bpy.ops.object.transform_apply(scale=True)
    C.set_material(cut, mat_pocket)

    md = table.modifiers.new("recess", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cut
    md.solver = "EXACT" if hasattr(md, "solver") else md.solver
    if hasattr(md, "material_mode"):
        md.material_mode = "TRANSFER"
    C.apply_mod(table, md)
    bpy.data.objects.remove(cut, do_unlink=True)
    return table


def material_audit(obj):
    """(empty slot indices, count of polygons pointing at one)."""
    empties = [i for i, m in enumerate(obj.data.materials) if m is None]
    bad = sum(1 for p in obj.data.polygons if p.material_index in empties
              or p.material_index >= len(obj.data.materials))
    return empties, bad


def build_table():
    """Returns {'Table','Shoe','ChipTray','DiscardTray'}."""
    mat_felt = C.pbr("S7_Felt", C.FELT, 0.0, 0.92)
    mat_rail = C.pbr("S7_Rail", C.srgb("#231a10"), 0.0, 0.55)
    mat_gold = C.pbr("S7_TableGold", C.GOLD, 0.85, 0.26)
    mat_golddk = C.pbr("S7_TableGoldDk", C.GOLD_DK, 0.85, 0.34)
    mat_print = C.pbr("S7_FeltPrint", C.GOLD_DK, 0.30, 0.60)

    outer, inner, railmid = outlines()

    parts = []
    parts.append(slab("TableBody", outer, 0.0, SLAB_H, mat_rail))
    parts.append(slab("TableFelt", inner, SURFACE_Z, 0.012, mat_felt))
    parts.append(tube("TableTrim", inner, SURFACE_Z + 0.004, 0.010, mat_gold))
    parts.append(tube("TableRail", railmid, 0.012, RAIL_W * 0.50, mat_rail, res=5))

    bx, by, br = BET_CIRCLE
    circle = [(bx + br * math.cos(2 * math.pi * i / 64),
               by + br * math.sin(2 * math.pi * i / 64)) for i in range(64)]
    parts.append(tube("BetCircle", circle, SURFACE_Z + 0.003, 0.012, mat_gold))

    if FELT_PRINT:
        wx, wy, wh = WORDMARK
        parts.append(flat_text("SUITE 7", wx, wy, wh, mat_print,
                               name="FeltWordmark"))
        for txt, y, size in FELT_ROWS:
            a = arc_text(txt, PRINT_CY - y, PRINT_CY, size, mat_print,
                         name="FeltPrint_" + txt.split()[0])
            if a:
                parts.append(a)

    table = C.join(parts, "Table")

    mat_pocket = C.pbr("S7_TrayPocket", C.srgb("#0a0805"), 0.0, 0.70)
    cut_tray_recess(table, mat_pocket)
    empties, bad = material_audit(table)
    if empties or bad:
        raise RuntimeError("boolean left %d empty material slot(s) and %d "
                           "polygons pointing at one -- Table would render "
                           "white" % (len(empties), bad))

    shoe = build_shoe()
    chip = build_tray("ChipTray", 1.55, 0.40, 4, mat_rail, mat_golddk)
    # sit the rack on the pocket floor: floor + half the tray's 0.030 base
    chip.location = (0.0, CHIPTRAY_Y, SURFACE_Z - CHIPTRAY_RECESS + 0.015)
    disc = build_tray("DiscardTray", 0.52, 0.40, 1, mat_rail, mat_golddk)
    disc.location = (DISCARD_XY[0], DISCARD_XY[1], SURFACE_Z + 0.016)

    return {"Table": table, "Shoe": shoe, "ChipTray": chip, "DiscardTray": disc}


def shoe_mouth():
    """World point + heading the CardDeal clip pulls a card from.

    Derived from the Shoe's actual transform rather than hard-coded, so it
    cannot drift when the shoe moves. Local (0,-0.36,-0.055) is the slot.
    """
    from mathutils import Vector
    shoe = bpy.data.objects.get("Shoe")
    if shoe is None:
        return (SHOE_XY[0], SHOE_XY[1], SURFACE_Z + 0.10), SHOE_YAW
    p = shoe.matrix_world @ Vector((0.0, -0.36, -0.055))
    return (p.x, p.y, p.z), SHOE_YAW


def _main():
    C.clear_scene()
    objs = build_table()
    print("built:", sorted(objs))
    print("tris:", C.tri_count())
    bpy.ops.wm.save_as_mainfile(filepath=C.outpath("s7_table.blend"))


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_table"))
