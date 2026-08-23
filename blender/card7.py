"""card7.py -- render out/card.png, the 7 of spades sprite (Priority 2).

708 x 1024 transparent RGBA, toon look to match the approved chip. Unblocks
the site's falling chips+cards background.

    blender --background --python card7.py

Rewritten 2026-08-23. The original built its OWN simpler card, which meant
the falling-background art and the card in table-assets.glb would drift
apart the moment either changed. This renders the canonical
s7_props.build_card() instead, so there is exactly one Card7S design.

Three bugs the original carried:
  * bpy.ops.object.origin_set silently no-ops without a 3D-view context, so
    every glyph sat at its font-metric offset (see s7_common.glyph).
  * OUT pointed at ...\\Downloads\\suite7\\out\\, a different project.
  * Blender 5.2 gates image vs video: image_settings.media_type must be set
    to 'IMAGE' BEFORE file_format = 'PNG'.

The toon treatment (flat emission + inverted-hull outline) lives ONLY here.
It relies on use_backface_culling, which is EEVEE-only and does not survive
glTF -- it must never touch anything destined for table-assets.glb.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_props as P

RES_X, RES_Y = 708, 1024
OUTLINE = 0.0055

# flat toon bands, keyed to the material slots build_card() produces
TOON = {
    "S7_CardFace":      (C.srgb("#171207"), 1.0),
    "S7_CardBack":      (C.srgb("#241a0c"), 1.0),
    "S7_CardGold":      (C.GOLD,            1.0),
    "S7_CardPip":       (C.GOLD_HI,         1.0),
    "S7_CardBackGold":  (C.GOLD_DK,         1.0),
    "S7_CardBackFaint": (C.srgb("#5d4926"), 1.0),
}


def emission(name, color, strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = color
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs[0])
    m.diffuse_color = color
    return m


def toonify(obj):
    """Swap each Principled slot for a flat emission of the same hue."""
    for i, slot in enumerate(obj.data.materials):
        if slot is None:
            continue
        col, s = TOON.get(slot.name, (C.CREAM, 1.0))
        obj.data.materials[i] = emission("Toon_" + slot.name, col, s)


def add_outline(obj, thickness=OUTLINE):
    """Inverted hull: solidify outward, flip the normals, cull backfaces so
    only the silhouette rim survives. EEVEE only -- see module docstring."""
    hull = obj.copy()
    hull.data = obj.data.copy()
    hull.name = obj.name + "_Outline"
    C.link(hull)
    md = hull.modifiers.new("hull", "SOLIDIFY")
    md.thickness = thickness
    md.offset = 1.0
    md.use_flip_normals = True
    md.use_rim = False
    ink = emission("ToonInk", (0.0, 0.0, 0.0, 1.0), 1.0)
    ink.use_backface_culling = True
    hull.data.materials.clear()
    hull.data.materials.append(ink)
    for p in hull.data.polygons:
        p.material_index = 0
    return hull


def setup_render(scene, filepath):
    # The EEVEE enum identifier has moved twice: BLENDER_EEVEE ->
    # BLENDER_EEVEE_NEXT (4.2) -> BLENDER_EEVEE again (5.x). Read the enum
    # off this build rather than hardcoding a name that will be wrong.
    avail = [i.identifier for i in
             scene.render.bl_rna.properties["engine"].enum_items]
    for want in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if want in avail:
            scene.render.engine = want
            break
    else:
        raise RuntimeError("no EEVEE engine in %s" % avail)
    try:
        scene.eevee.use_shadows = False          # nothing to shadow: all emission
    except AttributeError:
        pass
    scene.render.film_transparent = True
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.resolution_percentage = 100
    # Blender 5.2 gates the format enum on media_type -- set it to IMAGE
    # first or 'PNG' is not in the enum yet and this throws.
    try:
        scene.render.image_settings.media_type = "IMAGE"
    except (AttributeError, TypeError):
        pass
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"   # keep the golds true
    scene.render.filepath = filepath


def build_and_render(filepath=None):
    filepath = filepath or C.outpath("card.png")
    C.clear_scene()

    card = P.build_card()
    card.rotation_euler = (0.0, 0.0, 0.0)
    toonify(card)
    add_outline(card)

    cam_data = bpy.data.cameras.new("CardCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = P.CARD_H + 0.055     # a hair of margin for the ink
    cam = bpy.data.objects.new("CardCam", cam_data)
    C.link(cam)
    cam.location = (0.0, 0.0, 3.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = cam

    setup_render(bpy.context.scene, filepath)
    bpy.ops.render.render(write_still=True)
    return filepath


def _main():
    p = build_and_render()
    print("card.png ->", p, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    sys.exit(C.run(_main, "card7"))
