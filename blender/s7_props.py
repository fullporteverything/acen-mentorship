"""s7_props.py -- Card7S and Chip7.

Names are the website's API. Never rename them.

    Card7S   0.62 x 0.90 x 0.02, origin at its CENTRE so the clips can
             rotate it about its own axes.
    Chip7    r 0.16, h 0.045, origin at its centre.

Everything is Principled BSDF and geometry only -- no Cycles-only nodes, no
Shader-to-RGB, no inverted-hull outlines (those need backface culling, which
is EEVEE-only and does not survive glTF).
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C

SPADE = "♠"

# -- Card7S --------------------------------------------------------------
CARD_W = 0.62
CARD_H = 0.90
CARD_T = 0.0176       # the SLAB. Printing stands CARD_RELIEF proud of each
CARD_RELIEF = 0.0012  # face, so the finished card measures exactly 0.0200.
CARD_R = 0.045        # corner radius
CARD_HALF_T = CARD_T / 2.0


def rounded_rect(w, h, r, seg=6):
    """CCW rounded rectangle centred on the origin."""
    hw, hh = w / 2.0 - r, h / 2.0 - r
    pts = []
    for cx, cy, a0 in ((hw, hh, 0.0),
                       (-hw, hh, math.pi / 2),
                       (-hw, -hh, math.pi),
                       (hw, -hh, 1.5 * math.pi)):
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def build_card():
    """Returns the Card7S object.

    CORNER-RADIUS NOTE. The brief warns that a 0.05 bevel on a 0.02 slab
    clamps and mangles, and prescribes bevelling a ~0.20 slab then scaling
    Z down. That does work, but the same bevel then also rounds the two
    face rims by 0.05, eating 0.10 of a 0.62-wide face before you have
    drawn anything. Generating the radius in the PROFILE instead removes
    the clamp risk entirely -- there is no bevel doing the corners at all
    -- and leaves the face flat. A separate 0.0035 bevel, far below the
    clamp threshold, does the edge softening.
    """
    mat_face = C.pbr("S7_CardFace", C.NEARBLACK, 0.0, 0.44)
    mat_gold = C.pbr("S7_CardGold", C.GOLD, 0.85, 0.28)
    mat_pip = C.pbr("S7_CardPip", C.GOLD_HI, 0.60, 0.32)
    mat_back = C.pbr("S7_CardBack", C.srgb("#241a0c"), 0.0, 0.50)
    mat_bkgold = C.pbr("S7_CardBackGold", C.GOLD_DK, 0.80, 0.36)
    # the back spade is meant to read FAINT, a watermark under the
    # hairlines rather than a second centre pip competing with the face
    mat_faint = C.pbr("S7_CardBackFaint", C.srgb("#5d4926"), 0.55, 0.52)

    parts = []

    # --- the slab ---------------------------------------------------------
    slab = C.ngon("CardSlab", rounded_rect(CARD_W, CARD_H, CARD_R, seg=6),
                  z=CARD_HALF_T)
    md = slab.modifiers.new("solid", "SOLIDIFY")
    md.thickness = CARD_T
    md.offset = -1.0
    C.apply_mod(slab, md)
    bev = slab.modifiers.new("soft", "BEVEL")
    bev.width = 0.0035          # 0.0035 << CARD_T/2, nowhere near clamping
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(30.0)
    C.apply_mod(slab, bev)
    C.set_material(slab, mat_face)
    parts.append(slab)

    # --- back plate, so the reverse is not the face colour -----------------
    back = C.ngon("CardBack", rounded_rect(CARD_W - 0.008, CARD_H - 0.008,
                                           CARD_R - 0.004, seg=6),
                  z=-(CARD_HALF_T + 0.0003))
    C.set_material(back, mat_back)
    parts.append(back)

    # --- printed elements -------------------------------------------------
    # Everything printed is sunk so it clears the face by exactly
    # CARD_RELIEF; the rest of its body is buried in the slab. Without this
    # a 0.0055 piping tube centred on the face stood 0.0055 proud and the
    # card measured 0.029 thick instead of 0.020.
    def frame(name, inset, depth, mat, side=1.0):
        pts = rounded_rect(CARD_W - 2 * inset, CARD_H - 2 * inset,
                           max(0.008, CARD_R - inset), seg=5)
        z = side * (CARD_HALF_T + CARD_RELIEF - depth)
        ob = C.poly_curve(name, pts, z=z, depth=depth, resolution=2)
        ob = C.to_mesh(ob)
        ob.name = name
        C.set_material(ob, mat)
        return ob

    def pip(body, font, name, height, mat, x, y, side=1.0, spin=0.0,
            extrude=0.0020, res=2):
        g = C.glyph(body, font, name, height, mat, extrude=extrude,
                    resolution_u=res)
        # C.glyph normalises ink height with a UNIFORM scale, which scales
        # the extrude too -- so the nominal extrude is not the finished
        # thickness. Measure it, or the pips sit proud by an arbitrary
        # amount (they overshot the 0.020 card by 0.0006).
        #
        # Measure off MESH DATA, not ob.dimensions: dimensions comes from
        # the cached bound_box and is stale until the depsgraph ticks, so
        # reading it here returned the PRE-scale thickness and sank every
        # index glyph inside the slab, where it vanished.
        zs = [v.co.z for v in g.data.vertices]
        half = (max(zs) - min(zs)) / 2.0
        g.location = (x, y, side * (CARD_HALF_T + CARD_RELIEF - half))
        g.rotation_euler = ((0.0, 0.0, spin) if side > 0
                            else (math.pi, 0.0, spin))
        return g

    parts.append(frame("CardBorderOuter", 0.034, 0.0055, mat_gold))
    parts.append(frame("CardBorderInner", 0.055, 0.0022, mat_gold))

    # --- corner indices: 7 over a spade, and the same rotated 180 ----------
    # Kept clear of the inner border line (x +/-0.255, y +/-0.395); at the
    # first sizing the 7's cap landed on it at 0.394.
    ix, iy = -CARD_W / 2 + 0.105, CARD_H / 2 - 0.125
    for sgn, tag in ((1.0, "TL"), (-1.0, "BR")):
        spin = 0.0 if sgn > 0 else math.pi
        parts.append(pip("7", C.GEORGIA, "Idx7_" + tag, 0.085, mat_pip,
                         sgn * ix, sgn * iy, spin=spin))
        parts.append(pip(SPADE, C.SEGUISYM, "IdxS_" + tag, 0.058, mat_pip,
                         sgn * ix, sgn * (iy - 0.103), spin=spin))

    # --- big centre spade --------------------------------------------------
    parts.append(pip(SPADE, C.SEGUISYM, "CardSpade", 0.32, mat_pip,
                     0.0, 0.0, extrude=0.0022, res=3))

    # --- back: gold hairlines + a faint spade ------------------------------
    for i, inset in enumerate((0.034, 0.050, 0.062)):
        parts.append(frame("CardBackLine%d" % i, inset,
                           0.0030 if i == 0 else 0.0016, mat_bkgold,
                           side=-1.0))
    parts.append(pip(SPADE, C.SEGUISYM, "CardBackSpade", 0.34, mat_faint,
                     0.0, 0.0, side=-1.0, extrude=0.0018, res=3))

    card = C.join(parts, "Card7S")
    card.name = "Card7S"
    return card


# -- Chip7 ---------------------------------------------------------------
CHIP_R = 0.16
CHIP_H = 0.045
CHIP_NOTCHES = 8
CHIP_SEG = 48
CHIP_RELIEF = 0.0022
CHIP_BODY_R = 0.1585     # body stops just shy of CHIP_R so the cream edge
                         # notches are the widest part, as on a real chip --
                         # keeps the finished diameter exactly 0.320
CHIP_RECESS_Z = 0.0185   # recessed face; rim ring top is CHIP_H/2 = 0.0225

# (radius, z) half-section, revolved about Z. Top face first.
CHIP_PROFILE = (
    (0.0000,  0.0185),
    (0.1230,  0.0185),   # flat recessed face
    (0.1270,  0.0225),   # crisp step up to the rim ring
    (0.1525,  0.0225),   # rim ring top
    (0.1575,  0.0200),
    (0.1585,  0.0150),
    (0.1585, -0.0150),   # outer wall
    (0.1575, -0.0200),
    (0.1525, -0.0225),
    (0.1270, -0.0225),
    (0.1230, -0.0185),
    (0.0000, -0.0185),
)


def revolve(name, profile, seg=CHIP_SEG):
    """Lathe a (r, z) profile about Z, built straight into mesh data.

    Not bpy.ops.mesh.spin: that needs edit mode and a 3D-view context,
    which is exactly the class of operator that silently no-ops over
    blender-mcp. Not a boolean either, so the empty-material-slot-at-
    index-0 gotcha never arises. Profile endpoints at r == 0 collapse to
    single pole vertices instead of degenerate quads.
    """
    prof = list(profile)
    top_pole = prof[0][0] <= 1e-9
    bot_pole = prof[-1][0] <= 1e-9
    ring = prof[1:] if top_pole else prof
    ring = ring[:-1] if bot_pole else ring
    n = len(ring)

    verts = []
    vi_top = vi_bot = None
    if top_pole:
        vi_top = 0
        verts.append((0.0, 0.0, prof[0][1]))
    base = len(verts)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        for r, z in ring:
            verts.append((r * ca, r * sa, z))
    if bot_pole:
        verts.append((0.0, 0.0, prof[-1][1]))
        vi_bot = len(verts) - 1

    def idx(i, k):
        return base + (i % seg) * n + k

    faces = []
    for i in range(seg):
        if top_pole:
            faces.append((vi_top, idx(i, 0), idx(i + 1, 0)))
        for k in range(n - 1):
            faces.append((idx(i, k), idx(i, k + 1),
                          idx(i + 1, k + 1), idx(i + 1, k)))
        if bot_pole:
            faces.append((vi_bot, idx(i + 1, n - 1), idx(i, n - 1)))

    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    return C.link(bpy.data.objects.new(name, me))


def build_chip(label="7", body_color=None, name="Chip7"):
    """Returns the Chip7 object -- the approved toon coin's design language
    at chip scale: crimson body, cream rim notches, big gold 7 both faces.

    The notches are built as cream arc SEGMENTS of the rim rather than cut
    with booleans. A boolean here would buy nothing visually and would drag
    in the empty-material-slot-at-index-0 gotcha for no reason.
    """
    mat_body = C.pbr("S7_ChipBody" if body_color is None else "S7_ChipBody_" + name,
                     C.CRIMSON if body_color is None else body_color, 0.0, 0.42)
    mat_cream = C.pbr("S7_ChipCream", C.CREAM, 0.0, 0.48)
    mat_gold = C.pbr("S7_ChipGold", C.GOLD_HI, 0.70, 0.30)   # pale cream-gold, per chip_toon.png

    parts = []

    # body: recessed face + raised rim ring, straight off the profile
    body = revolve("ChipBody", CHIP_PROFILE)
    C.set_material(body, mat_body)
    parts.append(body)

    # cream rim notches -- arc slabs standing 0.0015 proud of the body, so
    # they are the widest thing on the chip and read as inlaid edge spots
    span = math.radians(20.0)
    nz = 0.0168
    for n in range(CHIP_NOTCHES):
        a0 = 2 * math.pi * n / CHIP_NOTCHES - span / 2
        pts = []
        steps = 5
        for i in range(steps + 1):                      # outer edge
            a = a0 + span * i / steps
            pts.append((CHIP_R * math.cos(a), CHIP_R * math.sin(a)))
        for i in range(steps, -1, -1):                  # inner edge
            a = a0 + span * i / steps
            pts.append((0.1400 * math.cos(a), 0.1400 * math.sin(a)))
        ob = C.ngon("ChipNotch%d" % n, pts, z=nz)
        md = ob.modifiers.new("solid", "SOLIDIFY")
        md.thickness = nz * 2.0
        md.offset = -1.0
        C.apply_mod(ob, md)
        C.set_material(ob, mat_cream)
        parts.append(ob)

    # the big label, nested INSIDE the recess on both faces (approved look:
    # it fills the recessed face rather than sitting as a small centre mark)
    for sgn in (1.0, -1.0):
        g = C.glyph(label, C.GEORGIA, "Chip7Face%d" % int(sgn), 0.190,
                    mat_gold, extrude=0.0030, resolution_u=3)
        # a 3-digit denomination is far wider than "7" -- clamp on WIDTH so
        # it stays inside the recess instead of running over the rim ring
        xs = [v.co.x for v in g.data.vertices]
        w = max(xs) - min(xs)
        if w > 0.210:
            k = 0.210 / w
            for v in g.data.vertices:
                v.co *= k
            g.data.update()
        zs = [v.co.z for v in g.data.vertices]
        half_t = (max(zs) - min(zs)) / 2.0
        g.location = (0.0, 0.0,
                      sgn * (CHIP_RECESS_Z + CHIP_RELIEF - half_t))
        if sgn < 0:
            g.rotation_euler = (math.pi, 0.0, 0.0)
        parts.append(g)

    chip = C.join(parts, name)
    chip.name = name
    return chip


def build_props():
    return {"Card7S": build_card(), "Chip7": build_chip()}


def _main():
    C.clear_scene()
    p = build_props()
    for k, o in sorted(p.items()):
        print(k, [round(v, 4) for v in o.dimensions])
    print("tris:", C.tri_count())


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_props"))
