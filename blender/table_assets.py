# table_assets.py — author the 3D blackjack assets + baked animations
#
# Run in a NEW scene. Builds a Suite 7 playing card (7♠ face + patterned back)
# and a casino chip, bakes three named actions —
#
#     CardDeal  (30f) — arc in from the shoe, settle flat
#     CardFlip  (20f) — lift, rotate PI about the long axis, set down
#     ChipToss  (24f) — small parabolic toss onto the felt
#
# — and exports everything to  //exports/table-assets.glb .
#
# On the site, components/TableScene.tsx has two factory functions
# (buildCardMesh / buildChipMesh) with procedural placeholders; when this .glb
# is copied to  public/brand/table-assets.glb  those factories are where the
# loaded meshes + AnimationClips get swapped in (GLTFLoader). The action names
# above are the contract — don't rename them.
#
# glTF notes: materials must be Principled BSDF (emission-only nodes don't
# survive export); animations export as clips named after the actions.

import math
import os

import bpy

GEORGIA = r"C:\Windows\Fonts\georgiab.ttf"
SEGUISYM = r"C:\Windows\Fonts\seguisym.ttf"
OUT = bpy.path.abspath("//exports/table-assets.glb")

W, H, T = 0.62, 0.90, 0.02          # card size (matches the site's proportions)
CHIP_R, CHIP_H = 0.16, 0.045        # chip size (matches TableScene placeholders)
GOLD = (0.890, 0.753, 0.443, 1.0)
GOLD_HI = (0.969, 0.910, 0.675, 1.0)
FACE = (0.020, 0.014, 0.008, 1.0)   # warm near-black
FPS = 30


def principled(name, color, metallic=0.0, rough=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 0.6
    return mat


def glyph(body, font_path, name, height, mat):
    """Text → ink-centered mesh (origin BOUNDS — the em-box gotcha)."""
    curve = bpy.data.curves.new(type="FONT", name=f"{name}_c")
    curve.body = body
    try:
        curve.font = bpy.data.fonts.load(font_path)
    except RuntimeError:
        print(f"WARN: no font at {font_path}")
    curve.extrude = 0.004
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    h = obj.dimensions.y
    if h > 0:
        s = height / h
        obj.scale = (s, s, s)
        bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


def build_card():
    """Rounded card slab + gold trim + 7♠ face glyphs + back pattern glyph."""
    gold = principled("S7_Gold", GOLD, metallic=0.9, rough=0.25, emission=GOLD)
    gold_hi = principled("S7_GoldHi", GOLD_HI, metallic=0.9, rough=0.2, emission=GOLD_HI)
    face = principled("S7_CardFace", FACE, rough=0.42)

    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.active_object
    body.scale = (W / 2, H / 2, T / 2)
    bpy.ops.object.transform_apply(scale=True)
    bev = body.modifiers.new("corner", "BEVEL")
    bev.limit_method = "ANGLE"
    bev.width = 0.05
    bev.segments = 6
    bpy.ops.object.modifier_apply(modifier=bev.name)
    body.data.materials.clear()          # bevel/boolean slot gotcha
    body.data.materials.append(face)
    for p in body.data.polygons:
        p.material_index = 0

    z = T / 2 + 0.002
    parts = [body]
    center = glyph("\u2660", SEGUISYM, "c_spade", 0.32, gold)
    center.location = (0, 0.01, z)
    parts.append(center)
    ix, iy = W / 2 - 0.085, H / 2 - 0.10
    for sx, sy, rot, tag in ((-1, 1, 0.0, "tl"), (1, -1, math.pi, "br")):
        seven = glyph("7", GEORGIA, f"c7_{tag}", 0.10, gold_hi)
        seven.location = (sx * ix, sy * iy, z)
        seven.rotation_euler = (0, 0, rot)
        pip = glyph("\u2660", SEGUISYM, f"cs_{tag}", 0.065, gold)
        pip.location = (sx * ix, sy * (iy - 0.10) if sy > 0 else sy * iy + 0.10, z)
        pip.rotation_euler = (0, 0, rot)
        parts.extend((seven, pip))
    # Back: one faint spade on the underside.
    back = glyph("\u2660", SEGUISYM, "c_back", 0.30, gold)
    back.location = (0, 0.0, -z)
    back.rotation_euler = (math.pi, 0, 0)
    parts.append(back)

    return join(parts, "Card7S")


def build_chip():
    gold = principled("S7_ChipGold", GOLD, metallic=0.85, rough=0.3, emission=GOLD)
    dark = principled("S7_ChipDark", (0.06, 0.04, 0.02, 1), rough=0.5)

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=CHIP_R, depth=CHIP_H)
    chip = bpy.context.active_object
    chip.data.materials.clear()
    chip.data.materials.append(gold)
    for p in chip.data.polygons:
        p.material_index = 0

    # Edge notches: 12 shallow dark boxes booleaned out… kept ADDITIVE instead
    # (thin dark plates on the rim) to avoid boolean/material headaches on a
    # tiny mesh.
    plates = []
    for i in range(12):
        a = (i / 12) * math.tau
        bpy.ops.mesh.primitive_cube_add(size=1)
        pl = bpy.context.active_object
        pl.scale = (0.018, 0.05, CHIP_H / 2 + 0.002)
        pl.location = (math.cos(a) * CHIP_R, math.sin(a) * CHIP_R, 0)
        pl.rotation_euler = (0, 0, a)
        bpy.ops.object.transform_apply(scale=True)
        pl.data.materials.clear()
        pl.data.materials.append(dark)
        plates.append(pl)

    seven = glyph("7", GEORGIA, "chip7", CHIP_R * 0.8,
                  principled("S7_Chip7", (0.15, 0.05, 0.08, 1), rough=0.4))
    seven.location = (0, 0, CHIP_H / 2 + 0.002)

    return join([chip, *plates, seven], "Chip7")


def key(obj, frame, loc=None, rot=None):
    bpy.context.scene.frame_set(frame)
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location")
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler")


def bake_actions(card, chip):
    scene = bpy.context.scene
    scene.render.fps = FPS

    # ── CardDeal: from the shoe (right, raised) arcing to the origin slot.
    card.animation_data_create()
    card.animation_data.action = bpy.data.actions.new("CardDeal")
    key(card, 1, loc=(2.2, 0.6, 0.55), rot=(0.35, 0.15, -0.5))
    key(card, 15, loc=(0.9, 0.25, 0.42), rot=(0.15, 0.05, -0.2))  # apex
    key(card, 30, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    deal = card.animation_data.action

    # ── CardFlip: lift, PI about the long (Y) axis, set down.
    card.animation_data.action = bpy.data.actions.new("CardFlip")
    key(card, 1, loc=(0, 0, 0), rot=(0, 0, 0))
    key(card, 10, loc=(0, 0, 0.15), rot=(0, math.pi / 2, 0))
    key(card, 20, loc=(0, 0, 0), rot=(0, math.pi, 0))
    flip = card.animation_data.action

    # ── ChipToss: small parabola onto the felt with a half-spin.
    chip.animation_data_create()
    chip.animation_data.action = bpy.data.actions.new("ChipToss")
    key(chip, 1, loc=(0.8, -0.6, 0.5), rot=(0.4, 0, 0))
    key(chip, 12, loc=(0.35, -0.25, 0.35), rot=(1.8, 0, 0.4))
    key(chip, 24, loc=(0.0, 0.0, CHIP_H / 2), rot=(math.tau, 0, 0.8))
    toss = chip.animation_data.action

    # Stash all actions so the exporter includes every clip (exporter reads
    # NLA/actions; push each onto an NLA track to be safe).
    for obj, actions in ((card, (deal, flip)), (chip, (toss,))):
        for act in actions:
            track = obj.animation_data.nla_tracks.new()
            track.name = act.name
            track.strips.new(act.name, 1, act)
        obj.animation_data.action = None


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    card = build_card()
    chip = build_chip()
    chip.location = (1.2, 0, 0)  # park beside the card in the file

    bake_actions(card, chip)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_yup=True,
    )
    print(f"Done: {OUT}")
    print("Copy to the site repo at public/brand/table-assets.glb — the")
    print("TableScene factories + clip names (CardDeal/CardFlip/ChipToss) are the contract.")


main()
