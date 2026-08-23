# suite7_face.py — rebrand the coin's heads face: DOJO → 7
#
# Run inside "dojo gamble coin.blend". Replaces the Txt_DOJO mesh with a big
# lining "7" (georgiab.ttf), parented to ChipRig exactly like the old wordmark,
# sitting on the recessed heads face (z = +0.070, extrude 0.014 — the same
# placement spec as the original build). The ϕ tails face (Txt.002) is left
# completely untouched, as is the 150-frame flip animation on ChipRig.
#
# After running: File → Save As… → "suite7 coin.blend" (keep the original).

import bpy

FONT_PATH = r"C:\Windows\Fonts\georgiab.ttf"  # Georgia Bold — matches the site
FACE_Z = 0.070          # recessed heads face height (from the coin spec)
EXTRUDE = 0.014         # glyph relief depth (same as the DOJO text)
TARGET_HEIGHT = 1.05    # world-units tall for the "7" — big, single glyph face
OLD_NAME = "Txt_DOJO"
NEW_NAME = "Txt_7"
RIG_NAME = "ChipRig"


def find(name):
    return bpy.data.objects.get(name)


def main():
    rig = find(RIG_NAME)
    if rig is None:
        raise RuntimeError(f"{RIG_NAME} not found — is the coin .blend open?")

    # Grab the old wordmark's material before deleting it, so the new glyph
    # renders identically in BOTH looks (toon2.py / look.py just restyle mats).
    old = find(OLD_NAME)
    face_mat = None
    if old is not None:
        if old.data.materials:
            face_mat = old.data.materials[0]
        bpy.data.objects.remove(old, do_unlink=True)

    # Build the "7" as a text object first…
    curve = bpy.data.curves.new(type="FONT", name=f"{NEW_NAME}_curve")
    curve.body = "7"
    try:
        curve.font = bpy.data.fonts.load(FONT_PATH)
    except RuntimeError:
        print(f"WARN: could not load {FONT_PATH}; using Blender default font")
    curve.extrude = EXTRUDE / 2  # curve extrude is symmetric; final via solidify-free mesh
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"     # em-box centering — fixed after mesh conversion

    txt = bpy.data.objects.new(NEW_NAME, curve)
    bpy.context.scene.collection.objects.link(txt)

    # …convert to mesh so there's no font dependency in the saved .blend, and
    # so we can center on the GLYPH INK, not the em-box (the ϕ lesson).
    bpy.ops.object.select_all(action="DESELECT")
    txt.select_set(True)
    bpy.context.view_layer.objects.active = txt
    bpy.ops.object.convert(target="MESH")
    txt = bpy.context.view_layer.objects.active
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    # Scale the glyph to TARGET_HEIGHT world units.
    h = txt.dimensions.y
    if h > 0:
        s = TARGET_HEIGHT / h
        txt.scale = (s, s, s)
        bpy.ops.object.transform_apply(scale=True)

    # Sit it on the recessed heads face.
    txt.location = (0.0, 0.0, FACE_Z)

    # Material: reuse the old wordmark's so both look scripts keep working.
    txt.data.materials.clear()
    if face_mat is not None:
        txt.data.materials.append(face_mat)
    for poly in txt.data.polygons:
        poly.material_index = 0

    # Parent to the rig (keep transform) so the flip animation carries it.
    txt.parent = rig
    txt.matrix_parent_inverse = rig.matrix_world.inverted()

    print("Done: heads face is now a lining 7. Save As 'suite7 coin.blend'.")


main()
