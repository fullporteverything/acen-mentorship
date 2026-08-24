"""render_chips.py -- toon chip sprites (Priority 3, optional).

    out/chip-25.png   cream body
    out/chip-100.png  gold body
    out/chip-500.png  crimson body

1024 x 1024 transparent RGBA, same toon treatment as card7.py so the whole
sprite set reads as one system. Reuses card7's emission/outline/render
helpers rather than duplicating them.

The toon outline is EEVEE-only (backface culling) and lives ONLY in these
sprite renders -- never in table-assets.glb.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_props as P
import card7

RES = 1024
TILT = math.radians(20.0)      # enough to show the rim ring and edge notches

DENOMS = (
    ("chip-25",  "25",  "#F5F0F0"),   # cream
    ("chip-100", "100", "#e3c071"),   # gold
    ("chip-500", "500", "#b21d3b"),   # crimson
)

def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def render_one(tag, label, body_hex):
    C.clear_scene()
    body = C.srgb(body_hex)
    chip = P.build_chip(label=label, body_color=body, name="ChipDenom")
    chip.rotation_euler = (TILT, 0.0, 0.0)

    # Flat toon has no shading to separate same-value regions, and the
    # inverted hull draws only the SILHOUETTE, not internal edges. So a
    # cream body with the stock cream notches and pale-gold numeral came
    # out as a blank disc. Pick the accents against the body's luminance.
    light_body = luminance(body) > 0.20
    notch_col = C.srgb("#2e2312") if light_body else C.CREAM
    num_col = C.srgb("#4a3616") if light_body else C.GOLD_HI

    swap = {"S7_ChipCream": notch_col, "S7_ChipGold": num_col}
    for i, slot in enumerate(chip.data.materials):
        if slot is None:
            continue
        col = swap.get(slot.name, body)
        chip.data.materials[i] = card7.emission(
            "ToonChip_%s_%s" % (tag, slot.name), col, 1.0)

    # The recessed-face step is real geometry but invisible when unlit --
    # draw it as an explicit line. Sprite-only; Chip7 in the glb is untouched.
    ring_col = tuple(v * 0.32 for v in body[:3]) + (1.0,)
    pts = [(0.1262 * math.cos(2 * math.pi * i / 72),
            0.1262 * math.sin(2 * math.pi * i / 72)) for i in range(72)]
    ring = C.poly_curve("RecessLine", pts, z=P.CHIP_RECESS_Z + 0.0016,
                        depth=0.0017, resolution=2)
    ring = C.to_mesh(ring)
    C.set_material(ring, card7.emission("ToonChipRing_" + tag, ring_col, 1.0))
    ring.rotation_euler = (TILT, 0.0, 0.0)

    card7.add_outline(chip, thickness=0.0035)

    cd = bpy.data.cameras.new("ChipCam")
    cd.type = "ORTHO"
    cd.ortho_scale = 0.375
    cam = bpy.data.objects.new("ChipCam", cd)
    C.link(cam)
    cam.location = (0.0, 0.0, 3.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = cam

    path = C.outpath(tag + ".png")
    sc = bpy.context.scene
    card7.setup_render(sc, path)
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    bpy.ops.render.render(write_still=True)
    return path


def render_all():
    made = []
    for tag, label, hexcol in DENOMS:
        made.append(render_one(tag, label, hexcol))
    return made


def _main():
    for p in render_all():
        print("%-40s %d bytes" % (p, os.path.getsize(p)))


if __name__ == "__main__":
    sys.exit(C.run(_main, "render_chips"))
