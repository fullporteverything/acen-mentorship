"""s7_dealer.py -- the faceless House dealer (WORKORDER-2 Priority 1).

    Dealer      one skinned mesh, torso + arms + hands, cut off at the neck
    DealerRig   the armature it is skinned to

    clips  DealerIdle (LOOPING) . DealerDeal . DealerFlip . DealerSweep

Neck-down and faceless on purpose -- the brand's House has no head. The
site frames the table from the player side at ~41 deg pitch, so the dealer
reads chest-to-waist above the rail; that is where the detail goes.

Rigging notes
-------------
Rigid skinning: every mesh part is weighted 1.0 to exactly one bone via a
vertex group named after it, then the parts are joined. Vertex groups
survive a join, so this needs no weight painting and cannot produce the
soft-weight artefacts a quick auto-weight would.

bpy.ops.object.mode_set DOES work over blender-mcp (verified before this
was written -- unlike origin_set, which fails silently, see BUILD-NOTES).
Bones can only be created in edit mode, so that operator is unavoidable
here; everything else stays ops-free.

Clips are FK bone rotation only, baked one key per frame, LINEAR. No IK:
the site only plays clips, and FK bakes are what survive glTF cleanly.
"""

import os
import sys
import math

import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_table as T

TAU = 2.0 * math.pi

# -- placement -----------------------------------------------------------
# Centred in the dealer notch. The notch cuts the table back to y = 1.23 at
# x = 0, so a torso centred at 1.62 stands IN the scallop with its front in
# the void -- no intersection with the table, which is the whole point of
# the notch.
DX, DY = 0.0, 1.70
WAIST_Z, NECK_Z = -0.08, 1.65   # NECK_Z must equal TORSO[-1][0]

# (z, width, depth) up the torso.
#
# SCALE NOTE. The first pass built a 0.92-wide, 1.08-tall torso. Against a
# 6.0 table that is 15% of the table's width where a real dealer is ~25%,
# and it put the neck only 1.0 above the felt when a standing dealer's neck
# is ~1.7 above a table that meets them at the waist. He read as a doll set
# behind the table. Everything below is that first pass at human scale.
#
# DY moved 1.62 -> 1.70 as well: at the wider shoulder the torso front was
# landing at y 1.29 against a notch boundary of 1.302, i.e. just inside the
# tabletop. The dealer now stands clear of it at every x.
TORSO = (
    (-0.08, 0.93, 0.54),
    (0.24, 0.99, 0.57),
    (0.60, 1.11, 0.61),
    (0.92, 1.23, 0.64),
    (1.16, 1.32, 0.66),
    (1.32, 1.38, 0.65),      # shoulder line
    (1.42, 1.26, 0.60),
    (1.52, 0.84, 0.51),
    (1.60, 0.51, 0.42),
    (1.65, 0.42, 0.38),      # flat neck cap
)

RING_N = 28
SE_E = 2.4                   # softer than a rounded box, firmer than an oval

# joints, dealer's RIGHT is +X (they face -Y, toward the player).
# The arms reach forward and down so the hands rest at the felt edge, which
# at this x is y = 1.03.
SHOULDER = (0.66, DY, 1.26)
ELBOW = (0.74, DY - 0.20, 0.62)
WRIST = (0.68, DY - 0.50, 0.20)
FINGERS = (0.64, DY - 0.68, 0.13)

BONES = ("hips", "chest", "neck",
         "shoulder_L", "upperarm_L", "forearm_L", "hand_L",
         "shoulder_R", "upperarm_R", "forearm_R", "hand_R")


# -- geometry helpers ----------------------------------------------------
def se_ring(w, d, z, n=RING_N, e=SE_E):
    """Superellipse ring -- a rounded rectangle, which reads as a torso
    rather than the barrel a plain circle would give."""
    pts = []
    for i in range(n):
        a = TAU * i / n
        ca, sa = math.cos(a), math.sin(a)
        x = (w / 2.0) * math.copysign(abs(ca) ** (2.0 / e), ca)
        y = (d / 2.0) * math.copysign(abs(sa) ** (2.0 / e), sa)
        pts.append((DX + x, DY + y, z))
    return pts


def loft(name, rings, cap_start=True, cap_end=True):
    """Quad-strip consecutive rings of equal length. Winding gives outward
    normals: ring order is CCW in XY and rings stack in +z."""
    n = len(rings[0])
    verts = []
    for r in rings:
        verts.extend(r)
    faces = []
    for k in range(len(rings) - 1):
        a, b = k * n, (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_start:
        faces.append(tuple(range(n - 1, -1, -1)))
    if cap_end:
        b = (len(rings) - 1) * n
        faces.append(tuple(range(b, b + n)))
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    return C.link(bpy.data.objects.new(name, me))


def _basis(p0, p1):
    w = (Vector(p1) - Vector(p0)).normalized()
    up = Vector((0.0, 0.0, 1.0)) if abs(w.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    u = w.cross(up).normalized()
    v = w.cross(u)
    return u, v, w


def limb(name, p0, p1, sections, n=14):
    """Tapered tube from p0 to p1. sections is [(t, width, depth)] with
    width across u and depth across v, so a hand can be flattened."""
    u, v, _ = _basis(p0, p1)
    a, b = Vector(p0), Vector(p1)
    rings = []
    for t, wid, dep in sections:
        c = a.lerp(b, t)
        ring = []
        for i in range(n):
            ang = TAU * i / n
            ring.append(tuple(c + u * (wid / 2.0 * math.cos(ang))
                              + v * (dep / 2.0 * math.sin(ang))))
        rings.append(ring)
    return loft(name, rings)


def se_point(w, d, z, ang_deg):
    """One superellipse point at an explicit angle -- the lapel is built by
    walking AROUND the body from the opening edge, not by pushing forward."""
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    x = (w / 2.0) * math.copysign(abs(ca) ** (2.0 / SE_E), ca)
    y = (d / 2.0) * math.copysign(abs(sa) ** (2.0 / SE_E), sa)
    return (DX + x, DY + y, z)


def open_ring(w, d, z, gap_deg, n=RING_N):
    """A ring with the FRONT left out -- from the right edge of the opening,
    around the back, to the left edge. gap_deg is the half-angle of the
    opening. This is what makes a jacket a jacket: a closed loft can only
    ever be a barrel."""
    a0 = math.radians(270.0 + gap_deg)
    a1 = math.radians(270.0 + 360.0 - gap_deg)
    pts = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / float(n - 1)
        ca, sa = math.cos(a), math.sin(a)
        x = (w / 2.0) * math.copysign(abs(ca) ** (2.0 / SE_E), ca)
        y = (d / 2.0) * math.copysign(abs(sa) ** (2.0 / SE_E), sa)
        pts.append((DX + x, DY + y, z))
    return pts


def open_loft(name, rings):
    """Loft rings as an OPEN shell (no wrap from last point back to first)."""
    n = len(rings[0])
    verts = []
    for r in rings:
        verts.extend(r)
    faces = []
    for k in range(len(rings) - 1):
        a, b = k * n, (k + 1) * n
        for i in range(n - 1):
            faces.append((a + i, a + i + 1, b + i + 1, b + i))
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    return C.link(bpy.data.objects.new(name, me))


def thicken(obj, t):
    """Give an open shell real thickness -- a garment seen from the player
    side would otherwise show its inside face through the opening."""
    md = obj.modifiers.new("solid", "SOLIDIFY")
    md.thickness = t
    md.offset = 0.0
    C.apply_mod(obj, md)
    return obj


JACKET_TOP = 1.34
JACKET_BOTTOM = -0.06
BUTTON_Z = 0.72          # below this the jacket is closed
LAPEL_GAP = 22.0         # half-angle of the opening at the collar


def jacket_gap(z):
    t = (z - BUTTON_Z) / (JACKET_TOP - BUTTON_Z)
    return LAPEL_GAP * max(0.0, min(1.0, t))


def torso_wd_at(z):
    """Interpolated (width, depth) of the torso at a height."""
    for i in range(len(TORSO) - 1):
        z0, w0, d0 = TORSO[i]
        z1, w1, d1 = TORSO[i + 1]
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0) if z1 > z0 else 0.0
            return w0 + (w1 - w0) * t, d0 + (d1 - d0) * t
    return TORSO[-1][1], TORSO[-1][2]


def torso_depth_at(z):
    """Interpolated torso depth, so the tie and lapel pin can be placed on
    the actual front surface instead of a guessed plane."""
    for i in range(len(TORSO) - 1):
        z0, _, d0 = TORSO[i]
        z1, _, d1 = TORSO[i + 1]
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0) if z1 > z0 else 0.0
            return d0 + (d1 - d0) * t
    return TORSO[-1][2]


# -- the mesh ------------------------------------------------------------
def build_parts():
    """Every part, tagged with the bone it rides. [(obj, bone)]

    An ACTUAL SUIT, not a vest: the first pass wrapped the torso in a closed
    dark shell and it read as a barrel from the player side. What makes a
    suit legible at a glance is the OPENING -- lapels framing a V of shirt
    and tie -- so the jacket is an open-front shell with real lapels, and
    the sleeves get cuffs.
    """
    shirt = C.pbr("S7_DealerShirt", C.srgb("#2a251a"), 0.0, 0.58)
    jacket = C.pbr("S7_DealerJacket", C.srgb("#0a0806"), 0.0, 0.34)
    lapelm = C.pbr("S7_DealerLapel", C.srgb("#0d0b08"), 0.0, 0.30)  # satin
    goldm = C.pbr("S7_DealerGold", C.GOLD, 0.85, 0.28)
    glove = C.pbr("S7_DealerGlove", C.srgb("#0a0a0a"), 0.0, 0.62)
    shade = C.pbr("S7_DealerNeck", C.srgb("#050403"), 0.0, 0.80)

    parts = []

    # shirt torso ---------------------------------------------------------
    body = loft("D_Shirt", [se_ring(w, d, z) for z, w, d in TORSO])
    C.set_material(body, shirt)
    parts.append((body, "chest"))

    # neck: a FLAT dark disc reading as the collar shadow. NO head.
    _, nw, nd = TORSO[-1]
    cap = loft("D_Neck", [se_ring(nw * 0.94, nd * 0.94, NECK_Z + 0.001),
                          se_ring(nw * 0.90, nd * 0.90, NECK_Z + 0.002)])
    C.set_material(cap, shade)
    parts.append((cap, "neck"))

    c0w, c0d = torso_wd_at(1.500)
    c1w, c1d = torso_wd_at(1.590)
    collar = loft("D_Collar", [se_ring(c0w * 1.05, c0d * 1.05, 1.500),
                               se_ring(c1w * 1.05, c1d * 1.05, 1.590)],
                  cap_start=False, cap_end=False)
    C.set_material(collar, jacket)
    parts.append((collar, "neck"))

    # gold tie in the V ---------------------------------------------------
    tie_rings = []
    for z, wdt in ((0.64, 0.090), (0.96, 0.084), (1.30, 0.064), (1.48, 0.040)):
        d = torso_depth_at(z)
        tie_rings.append([
            (DX - wdt / 2, DY - d / 2 - 0.010, z),
            (DX + wdt / 2, DY - d / 2 - 0.010, z),
            (DX + wdt / 2, DY - d / 2 + 0.012, z),
            (DX - wdt / 2, DY - d / 2 + 0.012, z),
        ])
    tie = loft("D_Tie", tie_rings)
    C.set_material(tie, goldm)
    parts.append((tie, "chest"))

    # jacket: open front ---------------------------------------------------
    zs = [JACKET_BOTTOM, 0.16, 0.44, BUTTON_Z, 0.88, 1.06, 1.22, JACKET_TOP]
    jrings = []
    for z in zs:
        w, d = torso_wd_at(z)
        jrings.append(open_ring(w * 1.045, d * 1.06, z, jacket_gap(z)))
    jk = open_loft("D_Jacket", jrings)
    thicken(jk, 0.020)
    C.set_material(jk, jacket)
    parts.append((jk, "chest"))

    # lapels: a strip lying ON the chest, folded outward from the opening.
    # First pass displaced the tip along -Y, which stood the lapels off the
    # body like a shelf and lit them like two pale triangles. Walking around
    # the body instead keeps them flat, which is what a lapel is.
    for side, dirn in (("R", 1.0), ("L", -1.0)):
        rows = []
        for z in zs:
            if z < BUTTON_Z:
                continue
            w, d = torso_wd_at(z)
            g = jacket_gap(z)
            t = (z - BUTTON_Z) / (JACKET_TOP - BUTTON_Z)
            spread = 20.0 * (t ** 0.5)
            e = se_point(w * 1.045, d * 1.06, z, 270.0 + dirn * g)
            tip = se_point(w * 1.085, d * 1.10, z - 0.010,
                           270.0 + dirn * (g + spread))
            rows.append([e, tip] if dirn > 0 else [tip, e])
        lp = open_loft("D_Lapel" + side, rows)
        thicken(lp, 0.014)
        C.set_material(lp, lapelm)
        parts.append((lp, "chest"))

    # phi lapel pin, dealer's left lapel
    pin = C.glyph("ϕ", C.SEGUISYM, "D_Pin", 0.094, goldm,
                  extrude=0.004, resolution_u=2)
    pz = 1.02
    pw, pd = torso_wd_at(pz)
    pin.location = (DX - pw * 0.30, DY - pd * 0.60 - 0.055, pz)
    pin.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    parts.append((pin, "chest"))

    # arms: sleeve, cuff, link, glove --------------------------------------
    for side, sx in (("R", 1.0), ("L", -1.0)):
        sh = (sx * SHOULDER[0], SHOULDER[1], SHOULDER[2])
        el = (sx * ELBOW[0], ELBOW[1], ELBOW[2])
        wr = (sx * WRIST[0], WRIST[1], WRIST[2])
        fg = (sx * FINGERS[0], FINGERS[1], FINGERS[2])
        cuff = tuple(Vector(el).lerp(Vector(wr), 0.84))

        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10,
                                             radius=0.220, location=sh)
        pad = bpy.context.active_object
        pad.name = "D_Shoulder" + side
        C.set_material(pad, jacket)
        parts.append((pad, "upperarm_" + side))

        ua = limb("D_SleeveU" + side, sh, el,
                  [(0.0, 0.39, 0.375), (0.5, 0.352, 0.338), (1.0, 0.308, 0.30)])
        C.set_material(ua, jacket)
        parts.append((ua, "upperarm_" + side))

        fa = limb("D_SleeveF" + side, el, cuff,
                  [(0.0, 0.308, 0.30), (0.6, 0.262, 0.252), (1.0, 0.228, 0.219)])
        C.set_material(fa, jacket)
        parts.append((fa, "forearm_" + side))

        cf = limb("D_Cuff" + side, cuff, wr,
                  [(0.0, 0.210, 0.201), (1.0, 0.192, 0.183)])
        C.set_material(cf, shirt)
        parts.append((cf, "forearm_" + side))

        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6,
                                             radius=0.032,
                                             location=(cuff[0] + sx * 0.093,
                                                       cuff[1] - 0.045,
                                                       cuff[2] - 0.018))
        link = bpy.context.active_object
        link.name = "D_Link" + side
        C.set_material(link, goldm)
        parts.append((link, "forearm_" + side))

        hd = limb("D_Hand" + side, wr, fg,
                  [(0.0, 0.183, 0.174), (0.25, 0.225, 0.123),
                   (0.75, 0.215, 0.099), (1.0, 0.141, 0.063)])
        C.set_material(hd, glove)
        parts.append((hd, "hand_" + side))

    return parts


# -- the rig -------------------------------------------------------------
def build_rig():
    ad = bpy.data.armatures.new("DealerRig")
    arm = bpy.data.objects.new("DealerRig", ad)
    C.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def mk(name, head, tail, parent=None):
        b = ad.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = ad.edit_bones[parent]
            b.use_connect = False
        return b

    mk("hips", (DX, DY, WAIST_Z), (DX, DY, 0.55))
    mk("chest", (DX, DY, 0.55), (DX, DY, 1.32), "hips")
    mk("neck", (DX, DY, 1.32), (DX, DY, NECK_Z), "chest")
    for side, sx in (("R", 1.0), ("L", -1.0)):
        mk("shoulder_" + side, (sx * 0.14, DY, 1.26),
           (sx * SHOULDER[0], DY, 1.26), "chest")
        mk("upperarm_" + side, (sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]),
           (sx * ELBOW[0], ELBOW[1], ELBOW[2]), "shoulder_" + side)
        mk("forearm_" + side, (sx * ELBOW[0], ELBOW[1], ELBOW[2]),
           (sx * WRIST[0], WRIST[1], WRIST[2]), "upperarm_" + side)
        mk("hand_" + side, (sx * WRIST[0], WRIST[1], WRIST[2]),
           (sx * FINGERS[0], FINGERS[1], FINGERS[2]), "forearm_" + side)

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def build_dealer():
    """Returns (Dealer mesh, DealerRig armature)."""
    parts = build_parts()
    for obj, bone in parts:
        vg = obj.vertex_groups.new(name=bone)
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")

    dealer = C.join([o for o, _ in parts], "Dealer")
    dealer.name = "Dealer"

    arm = build_rig()
    md = dealer.modifiers.new("skin", "ARMATURE")
    md.object = arm
    dealer.parent = arm
    # identity, never parent.matrix_world.inverted() -- that cancels the
    # child's placement the moment the parent is animated (the coin bug)
    dealer.matrix_parent_inverse = Matrix.Identity(4)
    return dealer, arm


# -- clips ---------------------------------------------------------------
FPS = 30
IDLE_N = 120          # 4.0 s, LOOPING
DEAL_N = 40
FLIP_N = 20
SWEEP_N = 30

LOOPING = {"DealerIdle"}


def _b(**kw):
    return kw


def bell(u):
    """Zero value AND zero slope at both ends."""
    return 0.5 * (1.0 - math.cos(TAU * u))


def bump(u, c, wdt):
    return math.exp(-(((u - c) / wdt) ** 2))


def pose_idle(f):
    """Breathing sway plus two finger taps. Every term is periodic in u
    with an integer number of cycles, so frame 1 and frame N are identical
    in value AND slope -- that is what makes the loop seamless rather than
    merely continuous."""
    u = (f - 1) / float(IDLE_N - 1)
    br = math.sin(TAU * u)
    sway = math.sin(TAU * u * 0.5 + 0.0) if False else math.sin(TAU * u)
    tap = bump(u, 0.52, 0.020) + bump(u, 0.60, 0.020)
    return {
        "chest": (math.radians(1.7) * br, 0.0, math.radians(0.8) * math.sin(TAU * u)),
        "neck": (math.radians(1.1) * math.sin(TAU * u + 0.6), 0.0, 0.0),
        "shoulder_R": (0.0, 0.0, math.radians(-1.2) * br),
        "shoulder_L": (0.0, 0.0, math.radians(1.2) * br),
        "upperarm_R": (math.radians(1.4) * br, 0.0, 0.0),
        "upperarm_L": (math.radians(1.4) * math.sin(TAU * u + 1.1), 0.0, 0.0),
        "forearm_R": (math.radians(-1.0) * br, 0.0, 0.0),
        "hand_R": (math.radians(-11.0) * tap, 0.0, 0.0),
    }


def _ramp(f, a, b):
    if f <= a:
        return 0.0
    if f >= b:
        return 1.0
    t = (f - a) / float(b - a)
    return t * t * (3.0 - 2.0 * t)


def pose_deal(f):
    """Right hand out to the Shoe, then sweeps toward table centre.

    Timed against CardDeal, whose card clears the shoe lip at frame 8: the
    reach peaks at 8 and the sweep runs 8 -> 26, so the card leaves as the
    hand passes.
    """
    reach = _ramp(f, 1, 8) - _ramp(f, 8, 24)
    sweep = _ramp(f, 8, 24) - _ramp(f, 26, DEAL_N)
    return {
        "shoulder_R": (0.0, 0.0, math.radians(-16.0) * reach + math.radians(11.0) * sweep),
        "upperarm_R": (math.radians(-26.0) * reach + math.radians(-6.0) * sweep,
                       0.0,
                       math.radians(-10.0) * reach + math.radians(20.0) * sweep),
        "forearm_R": (math.radians(16.0) * reach + math.radians(-12.0) * sweep, 0.0, 0.0),
        "hand_R": (math.radians(-8.0) * reach + math.radians(10.0) * sweep, 0.0, 0.0),
        "chest": (0.0, 0.0, math.radians(-4.0) * reach + math.radians(3.0) * sweep),
    }


def pose_flip(f):
    """A short wrist flick toward the hole-card spot."""
    u = (f - 1) / float(FLIP_N - 1)
    k = bell(u)
    return {
        "hand_R": (math.radians(-34.0) * k, math.radians(-18.0) * k, 0.0),
        "forearm_R": (math.radians(-9.0) * k, 0.0, 0.0),
        "upperarm_R": (math.radians(-5.0) * k, 0.0, 0.0),
    }


def pose_sweep(f):
    """Open-palm drag toward the ChipTray: reach out, draw back."""
    u = (f - 1) / float(SWEEP_N - 1)
    ext = bell(u)
    drag = math.sin(TAU * u)          # 0 at both ends, out then back
    return {
        "shoulder_R": (0.0, 0.0, math.radians(9.0) * ext),
        "upperarm_R": (math.radians(-20.0) * ext, 0.0, math.radians(13.0) * drag),
        "forearm_R": (math.radians(14.0) * ext, 0.0, math.radians(-8.0) * drag),
        "hand_R": (math.radians(-14.0) * ext, math.radians(9.0) * drag, 0.0),
        "chest": (0.0, 0.0, math.radians(3.0) * drag),
    }


CLIPS = (
    ("DealerIdle", 1, IDLE_N, pose_idle),
    ("DealerDeal", 1, DEAL_N, pose_deal),
    ("DealerFlip", 1, FLIP_N, pose_flip),
    ("DealerSweep", 1, SWEEP_N, pose_sweep),
)


def bake_pose(arm, name, f0, f1, pose):
    import s7_clips as K
    act = bpy.data.actions.new(name)
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    for f in range(f0, f1 + 1):
        p = pose(f)
        for bone in BONES:
            pb = arm.pose.bones[bone]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = p.get(bone, (0.0, 0.0, 0.0))
            pb.keyframe_insert("rotation_euler", frame=f)
    n = 0
    for fc in K.action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
            n += 1
    if n == 0:
        raise RuntimeError("baked no keys for %s" % name)
    return act


def rest_check(tol=1e-4):
    """Non-looping clips must start and end in the REST pose, or chaining
    them snaps. Looping clips are exempt by definition -- they are checked
    for closure instead."""
    bad = []
    for name, f0, f1, pose in CLIPS:
        if name in LOOPING:
            continue
        for tag, f in (("start", f0), ("end", f1)):
            for bone, rot in pose(f).items():
                if max(abs(v) for v in rot) > tol:
                    bad.append("%s %s: %s not at rest" % (name, tag, bone))
    return bad


def loop_check(tol=1e-4):
    """A looping clip must match in VALUE and SLOPE at the seam."""
    bad = []
    for name, f0, f1, pose in CLIPS:
        if name not in LOOPING:
            continue
        a, b = pose(f0), pose(f1)
        for bone in set(list(a) + list(b)):
            ra = a.get(bone, (0.0,) * 3)
            rb = b.get(bone, (0.0,) * 3)
            if max(abs(ra[i] - rb[i]) for i in range(3)) > tol:
                bad.append("%s: %s value mismatch at the seam" % (name, bone))
        # slope: step into frame 2 vs step out of frame f1-1
        a2, bm = pose(f0 + 1), pose(f1 - 1)
        for bone in BONES:
            din = tuple(a2.get(bone, (0.0,) * 3)[i] - a.get(bone, (0.0,) * 3)[i]
                        for i in range(3))
            dout = tuple(b.get(bone, (0.0,) * 3)[i] - bm.get(bone, (0.0,) * 3)[i]
                         for i in range(3))
            if max(abs(din[i] - dout[i]) for i in range(3)) > 2e-3:
                bad.append("%s: %s slope mismatch at the seam" % (name, bone))
    return bad


def build_clips(arm):
    import s7_clips as K
    bad = rest_check()
    if bad:
        raise RuntimeError("dealer rest: " + "; ".join(bad))
    bad = loop_check()
    if bad:
        raise RuntimeError("dealer loop: " + "; ".join(bad))
    made = {}
    for name, f0, f1, pose in CLIPS:
        act = bake_pose(arm, name, f0, f1, pose)
        K.push_nla(arm, act, name, f0)
        made[name] = act
    for pb in arm.pose.bones:
        pb.rotation_euler = (0.0, 0.0, 0.0)
    return made


def build_all():
    dealer, arm = build_dealer()
    build_clips(arm)
    return dealer, arm


def _main():
    C.clear_scene()
    d, a = build_all()
    print("Dealer dims:", [round(v, 3) for v in d.dimensions])
    print("bones:", len(a.pose.bones), " tris:", C.tri_count())


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_dealer"))
