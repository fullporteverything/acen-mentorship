# render_sprites.py — render the coin as a transparent web sprite
#
# Run inside the UPDATED coin .blend ("suite7 coin.blend", after
# suite7_face.py). Renders a single transparent-background frame of the chip,
# angled slightly (a touch of 3D reads better than dead-flat in the falling
# background), to  //renders/chip.png  next to the .blend.
#
# Copy the result to the site repo at  public/brand/chip.png  and set
#   textureUrl: "/brand/chip.png"
# on the chip entry of the "deck" variant in components/ThreeBackground.tsx.

import math
import os

import bpy

OUT = bpy.path.abspath("//renders/chip.png")
SIZE = 1024                 # plenty for a background sprite; downscales cleanly
FRAME = 1                   # frame 1 = the flat "hold on heads" pose
TILT_X = math.radians(18)   # slight tumble so the sprite has depth
TILT_Z = math.radians(-12)
RIG_NAME = "ChipRig"


def main():
    scene = bpy.context.scene
    rig = bpy.data.objects.get(RIG_NAME)
    if rig is None:
        raise RuntimeError(f"{RIG_NAME} not found — open the coin .blend first")

    scene.frame_set(FRAME)

    # Pose: mute the flip action for the still, apply a fixed tilt instead.
    saved_action = None
    if rig.animation_data and rig.animation_data.action:
        saved_action = rig.animation_data.action
        rig.animation_data.action = None
    saved_rot = tuple(rig.rotation_euler)
    rig.rotation_euler = (TILT_X, 0.0, TILT_Z)

    # Transparent film + RGBA PNG.
    scene.render.film_transparent = True
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT

    bpy.ops.render.render(write_still=True)

    # Restore the scene so nothing is permanently changed.
    rig.rotation_euler = saved_rot
    if saved_action is not None:
        rig.animation_data.action = saved_action
    scene.render.film_transparent = False

    print(f"Done: {OUT}  →  copy to public/brand/chip.png in the site repo")


main()
