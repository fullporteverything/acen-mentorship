"""s7_clips.py -- the four animation clips + the glTF export.

Clip names are the website's API and are never renamed:
    CardDeal . CardFlip . CardDiscard   (on Card7S)
    ChipToss                            (on Chip7)

Rules held throughout:
  * 30 fps.
  * Every clip starts and ends AT REST -- the easing functions all have
    zero derivative at both ends, so there is no velocity discontinuity
    when the site loops or chains them.
  * Root motion lives on the object itself (location + rotation_euler).
  * No camera or light is keyed. None is even created here.
  * Baked one key per frame with LINEAR interpolation. The easing is
    already in the sampled values; leaving the keys on BEZIER would let
    auto-handles overshoot between samples and reintroduce wobble at the
    ends that the maths deliberately removed.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_table as T

FPS = 30
TAU = 2.0 * math.pi

CARD_REST_Z = T.CARD_REST_Z          # 0.020
CHIP_REST_Z = T.SURFACE_Z + 0.0225   # chip half-height above the felt


# -- easing ---------------------------------------------------------------
def clamp01(t):
    return 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)


def ease_out(t, p=3.0):
    """Fast launch bleeding off speed -- the coin's flip easing."""
    return 1.0 - (1.0 - clamp01(t)) ** p


def ease_in_out(t):
    t = clamp01(t)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp2(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t))


# -- baking ---------------------------------------------------------------
def action_fcurves(act):
    """Every F-curve in an action, on old and new Blender alike.

    Blender 5.2 ships SLOTTED ACTIONS: Action.fcurves is gone and the
    curves now hang off action.layers[].strips[].channelbags[].fcurves.
    Reaching for .fcurves directly raises AttributeError mid-bake.
    """
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in getattr(layer, "strips", []):
            for cb in getattr(strip, "channelbags", []):
                out.extend(cb.fcurves)
    return out


def bake(obj, name, f0, f1, pose):
    """pose(frame) -> ((x,y,z), (rx,ry,rz)). Returns the new action."""
    act = bpy.data.actions.new(name)
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = act
    obj.rotation_mode = "XYZ"
    for f in range(f0, f1 + 1):
        loc, rot = pose(f)
        obj.location = loc
        obj.rotation_euler = rot
        obj.keyframe_insert("location", frame=f)
        obj.keyframe_insert("rotation_euler", frame=f)
    n = 0
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
            n += 1
    if n == 0:
        raise RuntimeError("baked no keyframes for %s -- action layout "
                           "changed again?" % name)
    return act


def push_nla(obj, act, track_name, start):
    """One action per NLA track, strip and track BOTH named after the
    action -- the glTF exporter takes the animation name from the track in
    NLA_TRACKS mode and from the action otherwise, so matching all three
    means the clip name survives whichever mode is used."""
    ad = obj.animation_data
    tr = ad.nla_tracks.new()
    tr.name = track_name
    st = tr.strips.new(track_name, int(start), act)
    st.name = track_name
    ad.action = None
    return tr


# -- CardDeal -------------------------------------------------------------
# The one that matters. Pulled from the shoe, released into a low spinning
# arc, lands with a skid and ~5 deg of residual rotation correcting to 0.
DEAL_F0, DEAL_PULL, DEAL_LAND, DEAL_F1 = 1, 8, 33, 40
DEAL_REST = (0.0, 0.0)
DEAL_SKID = 0.075        # metres of slide after touchdown
DEAL_TURNS = 2           # WHOLE turns, so -2 tau is identity: lands square
DEAL_RESIDUAL = math.radians(5.0)


def _deal_geometry():
    (mx, my, mz), yaw = T.shoe_mouth()
    # the shoe's local -Y in world: the direction a card travels leaving it
    out = (math.sin(yaw), -math.cos(yaw))
    p_in = (mx - out[0] * 0.13, my - out[1] * 0.13)     # back inside the slot
    p_out = (mx + out[0] * 0.05, my + out[1] * 0.05)    # just clear of the lip
    # touchdown sits SHORT of the rest point along the travel direction, so
    # the skid carries it the last few cm onto its mark
    tv = (DEAL_REST[0] - p_out[0], DEAL_REST[1] - p_out[1])
    tl = math.hypot(*tv) or 1.0
    tv = (tv[0] / tl, tv[1] / tl)
    p_land = (DEAL_REST[0] - tv[0] * DEAL_SKID,
              DEAL_REST[1] - tv[1] * DEAL_SKID)
    return p_in, p_out, p_land, mz, yaw


def pose_carddeal(f):
    p_in, p_out, p_land, mz, yaw = _deal_geometry()
    end_z = -DEAL_TURNS * TAU               # == 0 mod tau -> square

    if f <= DEAL_PULL:                      # straight pull along the shoe
        t = (f - DEAL_F0) / float(DEAL_PULL - DEAL_F0)
        p = lerp2(p_in, p_out, ease_in_out(t))
        return (p[0], p[1], mz), (T.SHOE_TILT, 0.0, yaw)

    if f <= DEAL_LAND:                      # low spinning arc across the felt
        u = (f - DEAL_PULL) / float(DEAL_LAND - DEAL_PULL)
        p = lerp2(p_out, p_land, ease_out(u, 2.2))
        # gentle ballistic bulge: z(0)=mz, z(1)=CARD_REST_Z
        a = 0.10
        b = a - (CARD_REST_Z - mz)
        z = mz + a * u - b * u * u
        rz = lerp(yaw, end_z + DEAL_RESIDUAL, ease_out(u, 2.4))
        decay = (1.0 - u)
        rx = lerp(T.SHOE_TILT, 0.0, ease_in_out(u)) + math.radians(7.0) * math.sin(math.pi * u) * decay
        ry = math.radians(5.0) * math.sin(TAU * u) * decay
        return (p[0], p[1], z), (rx, ry, rz)

    u = (f - DEAL_LAND) / float(DEAL_F1 - DEAL_LAND)     # skid and settle
    e = ease_out(u, 3.0)
    p = lerp2(p_land, DEAL_REST, e)
    z = CARD_REST_Z + 0.007 * math.sin(math.pi * u) * (1.0 - u)
    rz = lerp(end_z + DEAL_RESIDUAL, end_z, e)
    wob = math.radians(1.6) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (p[0], p[1], z), (wob, -wob, rz)


# -- CardFlip -------------------------------------------------------------
FLIP_F0, FLIP_F1 = 1, 20


def pose_cardflip(f):
    u = (f - FLIP_F0) / float(FLIP_F1 - FLIP_F0)
    # sin(pi*u) is the obvious lift shape and it is WRONG here: its
    # derivative is largest at u=0, so the card leaves the felt at full
    # speed instead of from rest. This bell -- sin^2(pi*u) -- has the same
    # single peak but zero slope at both ends.
    bell = 0.5 * (1.0 - math.cos(TAU * u))
    z = CARD_REST_Z + 0.15 * bell
    ry = math.pi * ease_in_out(u)
    x = 0.045 * bell                       # a touch of lateral drift
    rx = math.radians(4.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (x, 0.0, z), (rx, ry, 0.0)


# -- ChipToss -------------------------------------------------------------
TOSS_F0, TOSS_LAUNCH, TOSS_LAND, TOSS_F1 = 1, 3, 19, 24
TOSS_START = (0.62, -1.46)
TOSS_PEAK = 0.34


def pose_chiptoss(f):
    bx, by, _ = T.BET_CIRCLE            # land on the circle that actually
    target = (bx, by)                   # exists, not a hard-coded guess

    if f <= TOSS_LAUNCH:                # settled in the hand, tiny anticipation
        t = (f - TOSS_F0) / float(TOSS_LAUNCH - TOSS_F0)
        return (TOSS_START[0], TOSS_START[1],
                CHIP_REST_Z + 0.012 * ease_in_out(t)), (0.0, 0.0, 0.0)

    if f <= TOSS_LAND:                  # parabolic arc + a full flip
        u = (f - TOSS_LAUNCH) / float(TOSS_LAND - TOSS_LAUNCH)
        p = lerp2(TOSS_START, target, u)
        z0 = CHIP_REST_Z + 0.012
        z = lerp(z0, CHIP_REST_Z, u) + TOSS_PEAK * math.sin(math.pi * u)
        # ONE whole flip about X -> lands the same face up (7-up), and one
        # whole turn about Z -> the 7 lands upright
        rx = TAU * ease_out(u, 1.6)
        rz = TAU * ease_out(u, 2.0)
        return (p[0], p[1], z), (rx, 0.0, rz)

    u = (f - TOSS_LAND) / float(TOSS_F1 - TOSS_LAND)     # bounce + settle
    z = CHIP_REST_Z + 0.030 * math.sin(math.pi * u) * (1.0 - u) ** 1.5
    tilt = math.radians(6.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (target[0], target[1], z), (TAU + tilt, 0.0, TAU)


# -- CardDiscard ----------------------------------------------------------
DISC_F0, DISC_GO, DISC_LAND, DISC_F1 = 1, 4, 22, 26


def pose_carddiscard(f):
    tx, ty = T.DISCARD_XY
    tz = T.SURFACE_Z + 0.032          # settled down inside the tray walls

    if f <= DISC_GO:                  # small anticipation the other way
        t = (f - DISC_F0) / float(DISC_GO - DISC_F0)
        return (0.035 * ease_in_out(t), -0.012 * ease_in_out(t),
                CARD_REST_Z), (0.0, 0.0, 0.0)

    if f <= DISC_LAND:                # flicked away to the dealer's right
        u = (f - DISC_GO) / float(DISC_LAND - DISC_GO)
        e = ease_out(u, 2.0)
        p = lerp2((0.035, -0.012), (tx, ty), e)
        z = lerp(CARD_REST_Z, tz, e) + 0.085 * math.sin(math.pi * u)
        rz = -TAU * ease_out(u, 2.2)          # one whole turn -> lands square
        rx = math.radians(9.0) * math.sin(math.pi * u) * (1.0 - u)
        return (p[0], p[1], z), (rx, 0.0, rz)

    u = (f - DISC_LAND) / float(DISC_F1 - DISC_LAND)      # settle in the tray
    z = tz + 0.010 * math.sin(math.pi * u) * (1.0 - u)
    wob = math.radians(2.5) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (tx, ty, z), (wob, 0.0, -TAU)


# -- sprint 2 clips ------------------------------------------------------
# Some of these move MORE THAN ONE object. Blender has no multi-object
# action, so each participant gets its own NLA track carrying the SAME
# track name; the glTF exporter groups tracks by name in NLA_TRACKS mode,
# so they arrive at the site as a single animation. Blender will suffix
# the second Action ".001" -- that is internal, the exported name comes
# from the track.
REST = {}

CHIP_TRAY_XY = (0.0, T.CHIPTRAY_Y)
# Derived, never restated: pocket floor + half the tray's 0.030 base + the
# chip's own half-height. The rack is recessed into the felt, so this is
# BELOW the playing surface -- hard-coding it would break the moment
# CHIPTRAY_RECESS moves.
CHIP_TRAY_Z = (T.SURFACE_Z - T.CHIPTRAY_RECESS) + 0.030 + 0.0225


def capture_rest():
    """Snapshot rest transforms the poses need in ABSOLUTE terms.

    Read off the built objects rather than restated as constants -- the
    Shoe's z in particular is solved at build time from its tilted bbox,
    so hard-coding it here would silently drift the moment the shoe moves.
    """
    sh = bpy.data.objects["Shoe"]
    REST["Shoe_loc"] = tuple(sh.location)
    REST["Shoe_rot"] = tuple(sh.rotation_euler)


# -- ChipPayout: tray -> bet spot ----------------------------------------
PAY_F0, PAY_UP, PAY_LAND, PAY_F1 = 1, 5, 22, 28


def pose_chippayout(f):
    bx, by, _ = T.BET_CIRCLE
    sx, sy = CHIP_TRAY_XY
    lift = CHIP_TRAY_Z + 0.045
    if f <= PAY_UP:                                   # lift clear of the tray
        e = ease_in_out((f - PAY_F0) / float(PAY_UP - PAY_F0))
        return (sx, sy, CHIP_TRAY_Z + 0.045 * e), (0.0, 0.0, 0.0)
    if f <= PAY_LAND:                                 # slide out to the circle
        u = (f - PAY_UP) / float(PAY_LAND - PAY_UP)
        p = lerp2((sx, sy), (bx, by), ease_out(u, 2.0))
        z = lerp(lift, CHIP_REST_Z, u) + 0.05 * math.sin(math.pi * u)
        rx = math.radians(6.0) * math.sin(math.pi * u) * (1.0 - u)
        return (p[0], p[1], z), (rx, 0.0, TAU * ease_out(u, 2.0))
    u = (f - PAY_LAND) / float(PAY_F1 - PAY_LAND)     # settle on the circle
    z = CHIP_REST_Z + 0.012 * math.sin(math.pi * u) * (1.0 - u) ** 1.5
    tilt = math.radians(4.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (bx, by, z), (tilt, 0.0, TAU)


# -- ChipSweep: bet spot -> tray, dragged low ----------------------------
SWP_F0, SWP_GO, SWP_LAND, SWP_F1 = 1, 4, 24, 30


def pose_chipsweep(f):
    bx, by, _ = T.BET_CIRCLE
    tug = (bx + 0.020, by - 0.012)
    if f <= SWP_GO:                                 # brief tug before the drag
        e = ease_in_out((f - SWP_F0) / float(SWP_GO - SWP_F0))
        return (bx + 0.020 * e, by - 0.012 * e, CHIP_REST_Z), (0.0, 0.0, 0.0)
    if f <= SWP_LAND:
        u = (f - SWP_GO) / float(SWP_LAND - SWP_GO)
        p = lerp2(tug, CHIP_TRAY_XY, ease_in_out(u))
        # DRAGGED, not tossed: it stays down on the felt and only rises at
        # the very end to clear the tray wall
        z = lerp(CHIP_REST_Z, CHIP_TRAY_Z, ease_out(u, 2.5))
        rx = math.radians(5.0) * math.sin(math.pi * u) * (1.0 - u)
        return (p[0], p[1], z), (rx, 0.0, -TAU * ease_in_out(u))
    u = (f - SWP_LAND) / float(SWP_F1 - SWP_LAND)
    z = CHIP_TRAY_Z + 0.008 * math.sin(math.pi * u) * (1.0 - u)
    wob = math.radians(3.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (CHIP_TRAY_XY[0], CHIP_TRAY_XY[1], z), (wob, 0.0, -TAU)


# -- ShoeRefill: cut card drops in, shoe takes the weight ----------------
RFL_F0, RFL_GO, RFL_LAND, RFL_F1 = 1, 8, 34, 48
RFL_DROP = 0.60


def pose_shoerefill_card(f):
    sx, sy, sz = REST["Shoe_loc"]
    tz = sz + 0.02
    rot = (T.SHOE_TILT, 0.0, T.SHOE_YAW)
    if f <= RFL_GO:
        return (sx, sy, tz + RFL_DROP), rot
    if f <= RFL_LAND:
        u = (f - RFL_GO) / float(RFL_LAND - RFL_GO)
        z = lerp(tz + RFL_DROP, tz, u * u)            # accelerating fall
        rz = T.SHOE_YAW + math.radians(6.0) * math.sin(math.pi * u) * (1.0 - u)
        return (sx, sy, z), (T.SHOE_TILT, 0.0, rz)
    u = (f - RFL_LAND) / float(RFL_F1 - RFL_LAND)
    z = tz + 0.014 * math.sin(math.pi * u) * (1.0 - u) ** 1.5
    wob = math.radians(3.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (sx, sy, z), (T.SHOE_TILT + wob, 0.0, T.SHOE_YAW)


def pose_shoerefill_shoe(f):
    sx, sy, sz = REST["Shoe_loc"]
    rx, ry, rz = REST["Shoe_rot"]
    hit = RFL_LAND - 4
    if f <= hit:
        return (sx, sy, sz), (rx, ry, rz)
    u = (f - hit) / float(RFL_F1 - hit)
    dz = -0.012 * math.sin(math.pi * u) * (1.0 - u)   # takes the weight
    wob = math.radians(1.6) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (sx, sy, sz + dz), (rx + wob, ry, rz)


# -- TableIntro: 2.5 s establishing move, OBJECTS ONLY -------------------
INT_F0, INT_SHOE_GO, INT_SHOE_IN, INT_F1 = 1, 6, 48, 75
INT_CHIP_GO, INT_CHIP_LAND = 14, 44


def pose_tableintro_shoe(f):
    sx, sy, sz = REST["Shoe_loc"]
    rx, ry, rz = REST["Shoe_rot"]
    off = (sx + 1.75, sy + 0.60)
    if f <= INT_SHOE_GO:
        return (off[0], off[1], sz), (rx, ry, rz)
    if f <= INT_SHOE_IN:
        u = (f - INT_SHOE_GO) / float(INT_SHOE_IN - INT_SHOE_GO)
        p = lerp2(off, (sx, sy), ease_out(u, 3.0))
        return (p[0], p[1], sz), (rx, ry, rz)
    u = (f - INT_SHOE_IN) / float(INT_F1 - INT_SHOE_IN)
    d = 0.006 * math.sin(TAU * u) * (1.0 - u) ** 2
    return (sx + d, sy, sz), (rx, ry, rz)


def pose_tableintro_chip(f):
    x, y = CHIP_TRAY_XY
    if f <= INT_CHIP_GO:
        return (x, y, CHIP_TRAY_Z + 0.75), (0.0, 0.0, 0.0)
    if f <= INT_CHIP_LAND:
        u = (f - INT_CHIP_GO) / float(INT_CHIP_LAND - INT_CHIP_GO)
        z = lerp(CHIP_TRAY_Z + 0.75, CHIP_TRAY_Z, u * u)
        return (x, y, z), (0.0, 0.0, TAU * ease_out(u, 2.0))
    u = (f - INT_CHIP_LAND) / float(INT_F1 - INT_CHIP_LAND)
    z = CHIP_TRAY_Z + 0.035 * abs(math.sin(math.pi * u * 2.0)) * (1.0 - u) ** 2
    tilt = math.radians(5.0) * math.sin(TAU * u) * (1.0 - u) ** 2
    return (x, y, z), (tilt, 0.0, TAU)


# -- driver ---------------------------------------------------------------
CLIPS = (
    ("CardDeal",    "Card7S", DEAL_F0, DEAL_F1, pose_carddeal),
    ("CardFlip",    "Card7S", FLIP_F0, FLIP_F1, pose_cardflip),
    ("CardDiscard", "Card7S", DISC_F0, DISC_F1, pose_carddiscard),
    ("ChipToss",    "Chip7",  TOSS_F0, TOSS_F1, pose_chiptoss),
    ("ChipPayout",  "Chip7",  PAY_F0,  PAY_F1,  pose_chippayout),
    ("ChipSweep",   "Chip7",  SWP_F0,  SWP_F1,  pose_chipsweep),
    ("ShoeRefill",  "Card7S", RFL_F0,  RFL_F1,  pose_shoerefill_card),
    ("ShoeRefill",  "Shoe",   RFL_F0,  RFL_F1,  pose_shoerefill_shoe),
    ("TableIntro",  "Shoe",   INT_F0,  INT_F1,  pose_tableintro_shoe),
    ("TableIntro",  "Chip7",  INT_F0,  INT_F1,  pose_tableintro_chip),
)

CLIP_NAMES = ("CardDeal", "CardFlip", "CardDiscard", "ChipToss",
              "ChipPayout", "ChipSweep", "ShoeRefill", "TableIntro")

# Clips that deliberately end NOT axis-aligned, so square_check skips them:
# the ShoeRefill cut card and the TableIntro shoe both finish squared to the
# SHOE, which sits at -26 degrees.
SQUARE_EXEMPT = {"ShoeRefill", "TableIntro"}


def build_clips():
    """Bakes every clip and pushes each to its own NLA track."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0
    capture_rest()

    # validate the pose maths BEFORE baking 700-odd keyframes off it
    bad = rest_check()
    if bad:
        raise RuntimeError("clip does not start/end at rest: " + "; ".join(bad))
    bad = square_check()
    if bad:
        raise RuntimeError("clip does not land square: " + "; ".join(bad))

    made = {}
    for name, target, f0, f1, pose in CLIPS:
        obj = bpy.data.objects[target]
        act = bake(obj, name, f0, f1, pose)
        push_nla(obj, act, name, f0)
        made.setdefault(name, []).append(act)

    # leave everything parked at its rest pose, not mid-clip
    bpy.data.objects["Card7S"].location = (0.0, 0.0, CARD_REST_Z)
    bpy.data.objects["Card7S"].rotation_euler = (0.0, 0.0, 0.0)
    bpy.data.objects["Chip7"].location = (T.BET_CIRCLE[0], T.BET_CIRCLE[1],
                                          CHIP_REST_Z)
    bpy.data.objects["Chip7"].rotation_euler = (0.0, 0.0, 0.0)
    sh = bpy.data.objects["Shoe"]
    sh.location = REST["Shoe_loc"]
    sh.rotation_euler = REST["Shoe_rot"]

    sc.frame_start, sc.frame_end = 1, max(f1 for _, _, _, f1, _ in CLIPS)
    return made


def rest_check(frac=0.30):
    """Assert every clip starts and ends at rest.

    Tested as a RATIO, not an absolute: a clip is sampled at 30 fps, so
    even a perfectly eased start moves a little on its first frame. What
    matters is that the first and last steps are small next to the clip's
    peak step -- that is what 'no snap when the site plays or chains it'
    actually means. Returns complaint strings; empty is good.
    """
    if not REST and bpy.data.objects.get("Shoe") is not None:
        capture_rest()
    bad = []
    for name, target, f0, f1, pose in CLIPS:
        steps = []
        for f in range(f0, f1):
            (pa, ra), (pb, rb) = pose(f), pose(f + 1)
            dp = math.sqrt(sum((pb[i] - pa[i]) ** 2 for i in range(3)))
            dr = max(abs(rb[i] - ra[i]) for i in range(3))
            steps.append((dp, dr))
        mp = max(s[0] for s in steps) or 1e-9
        mr = max(s[1] for s in steps) or 1e-9
        for tag, s in (("start", steps[0]), ("end", steps[-1])):
            if s[0] > mp * frac or s[1] > mr * frac:
                bad.append("%-12s %-5s pos %5.1f%% of peak, rot %5.1f%% of peak"
                           % (name, tag, 100.0 * s[0] / mp, 100.0 * s[1] / mr))
    return bad


def square_check(tol=math.radians(0.25)):
    """Every clip must finish with Z a whole number of turns, or the prop
    lands visibly crooked. Only Z is checked: CardFlip deliberately ends at
    pi about Y -- that half-turn IS the reveal."""
    if not REST and bpy.data.objects.get("Shoe") is not None:
        capture_rest()
    bad = []
    for name, target, f0, f1, pose in CLIPS:
        if name in SQUARE_EXEMPT:
            continue
        _, r = pose(f1)
        turns = r[2] / TAU
        if abs(turns - round(turns)) * TAU > tol:
            bad.append("%s final Z = %.4f rad (%.4f turns)"
                       % (name, r[2], turns))
    return bad
