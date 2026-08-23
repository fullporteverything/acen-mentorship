# card7.py — build and render the Suite 7 playing card (7 of spades)
#
# Run in a NEW scene (File → New → General is fine; the script clears it).
# Builds a rounded-corner card with a near-black face, gold edge, mirrored
# "7♠" corner indices and a large center spade, then renders a transparent
# //renders/card.png (portrait). Copy to  public/brand/card.png  and set
#   textureUrl: "/brand/card.png"
# on the card entry of the "deck" variant in components/ThreeBackground.tsx.
#
# Styling matches the site: gold #e3c071 / highlight #f7e8ac on near-black.

import os

import bpy

GEORGIA = r"C:\Windows\Fonts\georgiab.ttf"
SEGUISYM = r"C:\Windows\Fonts\seguisym.ttf"  # has ♠ U+2660 (Georgia's is unreliable)
OUT = bpy.path.abspath("//renders/card.png")

W, H, T = 0.62, 0.90, 0.012   # card proportions (matches the site's 0.62x0.90 plane)
CORNER = 0.06                  # corner radius
GOLD = (0.890, 0.753, 0.443, 1.0)      # #e3c071
GOLD_HI = (0.969, 0.910, 0.675, 1.0)   # #f7e8ac
FACE = (0.012, 0.008, 0.006, 1.0)      # warm near-black (matches #171207 world)


def emission(name, color, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = color
    emit.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(emit.outputs[0], out.inputs[0])
    return mat


def glyph(body, font_path, name, height, mat):
    """Text → mesh, ink-centered (origin BOUNDS — the em-box gotcha)."""
    curve = bpy.data.curves.new(type="FONT", name=f"{name}_c")
    curve.body = body
    try:
        curve.font = bpy.data.fonts.load(font_path)
    except RuntimeError:
        print(f"WARN: no font at {font_path}, using default")
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


def main():
    # Clean scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    gold = emission("CardGold", GOLD, 1.2)
    gold_hi = emission("CardGoldHi", GOLD_HI, 1.4)
    face = emission("CardFace", FACE, 1.0)

    # Card body: rounded-rect via a beveled cube.
    bpy.ops.mesh.primitive_cube_add(size=1)
    card = bpy.context.active_object
    card.name = "Card"
    card.scale = (W / 2, H / 2, T / 2)
    bpy.ops.object.transform_apply(scale=True)
    bev = card.modifiers.new("corner", "BEVEL")
    bev.affect = "EDGES"
    bev.limit_method = "ANGLE"
    bev.width = CORNER
    bev.segments = 8
    bpy.ops.object.modifier_apply(modifier=bev.name)
    # Bevel/boolean slot gotcha: reset materials cleanly.
    card.data.materials.clear()
    card.data.materials.append(face)
    for p in card.data.polygons:
        p.material_index = 0

    # Gold edge: slightly larger flat frame behind the card reads as a border.
    bpy.ops.mesh.primitive_cube_add(size=1)
    frame = bpy.context.active_object
    frame.name = "CardEdge"
    frame.scale = ((W + 0.02) / 2, (H + 0.02) / 2, T / 2 * 0.9)
    frame.location = (0, 0, -0.002)
    bpy.ops.object.transform_apply(scale=True)
    fbev = frame.modifiers.new("corner", "BEVEL")
    fbev.limit_method = "ANGLE"
    fbev.width = CORNER
    fbev.segments = 8
    bpy.ops.object.modifier_apply(modifier=fbev.name)
    frame.data.materials.clear()
    frame.data.materials.append(gold)
    for p in frame.data.polygons:
        p.material_index = 0

    z = T / 2 + 0.003  # glyph rest height on the face

    # Center spade.
    spade = glyph("\u2660", SEGUISYM, "CenterSpade", 0.34, gold)
    spade.location = (0, 0.01, z)

    # Corner indices — 7 over ♠; bottom-right pair rotated 180°.
    ix, iy = W / 2 - 0.085, H / 2 - 0.10
    seven_tl = glyph("7", GEORGIA, "Idx7_tl", 0.105, gold_hi)
    seven_tl.location = (-ix, iy, z)
    spade_tl = glyph("\u2660", SEGUISYM, "IdxS_tl", 0.07, gold)
    spade_tl.location = (-ix, iy - 0.10, z)
    seven_br = glyph("7", GEORGIA, "Idx7_br", 0.105, gold_hi)
    seven_br.location = (ix, -iy, z)
    seven_br.rotation_euler = (0, 0, 3.14159)
    spade_br = glyph("\u2660", SEGUISYM, "IdxS_br", 0.07, gold)
    spade_br.location = (ix, -iy + 0.10, z)
    spade_br.rotation_euler = (0, 0, 3.14159)

    # Camera: straight-on orthographic portrait.
    bpy.ops.object.camera_add(location=(0, 0, 3))
    cam = bpy.context.active_object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = H + 0.16
    bpy.context.scene.camera = cam

    # Render settings: transparent RGBA portrait PNG.
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "SceneEEVEE") else scene.render.engine
    scene.render.film_transparent = True
    scene.render.resolution_x = 708   # W/H aspect of 0.62/0.90 at 1024 tall
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"  # keep the golds true
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)

    print(f"Done: {OUT}  →  copy to public/brand/card.png in the site repo")


main()
