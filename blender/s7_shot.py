"""s7_shot.py -- render the scene from the SITE'S camera.

WORKORDER-3 makes this mandatory before calling the dealer done: a
turntable or a front orthographic view hides exactly the silhouette
problems being fixed, which is how the last version shipped.

The site's camera, from components/TableScene.tsx:

    CAM_BASE   (0, 7.25, 11.63)
    CAM_TARGET (0, -0.20, -0.75)
    CAM_FOV    36            (three.js PerspectiveCamera fov is VERTICAL)
    aspect     1.78          (CAM_REF_ASPECT, the aspect the framing is solved at)
    TABLE_SCALE 1.9          (the site scales the whole glb root)

Coordinate conversion. The glb is exported +Y up, so a Blender point
(bx, by, bz) arrives in three.js as (bx, bz, -by), and the site then
scales it by TABLE_SCALE. Inverting that, a site point (X, Y, Z) sits at
Blender (X/S, -Z/S, Y/S). Both camera and target go through that, and the
scale cancels out of the field of view, so the framing matches exactly
without touching the scene.
"""

import os
import sys
import math

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C

TABLE_SCALE = 1.9
CAM_BASE_SITE = (0.0, 7.25, 11.63)
CAM_TARGET_SITE = (0.0, -0.20, -0.75)
CAM_FOV = 36.0
CAM_ASPECT = 1.78


def site_to_blender(p, scale=TABLE_SCALE):
    x, y, z = p
    return Vector((x / scale, -z / scale, y / scale))


def add_camera():
    cam_loc = site_to_blender(CAM_BASE_SITE)
    tgt = site_to_blender(CAM_TARGET_SITE)
    cd = bpy.data.cameras.new("SiteCam")
    cd.sensor_fit = "VERTICAL"          # three.js fov is the VERTICAL angle
    cd.angle_y = math.radians(CAM_FOV)
    cd.clip_start, cd.clip_end = 0.05, 100.0
    cam = bpy.data.objects.new("SiteCam", cd)
    C.link(cam)
    cam.location = cam_loc
    d = (tgt - cam_loc).normalized()
    # -Z forward, +Y up
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam, cam_loc, tgt


def add_lights():
    """A house lamp over the felt plus a rim, roughly what the site does.
    Enough to judge silhouette and value separation, which is the point."""
    made = []
    for name, kind, loc, energy, size, rot in (
        ("ShotKey", "AREA", (1.2, -1.1, 4.2), 620.0, 3.2, (0.45, 0.28, 0.55)),
        ("ShotFill", "AREA", (-2.2, -2.6, 2.6), 150.0, 4.0, (0.95, -0.25, -0.5)),
        ("ShotRim", "AREA", (-1.0, 3.4, 3.0), 420.0, 2.6, (-0.95, 0.0, 0.35)),
    ):
        ld = bpy.data.lights.new(name, type=kind)
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        C.link(ob)
        ob.location = loc
        ob.rotation_euler = rot
        made.append(ob)
    w = bpy.data.worlds.get("ShotWorld") or bpy.data.worlds.new("ShotWorld")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.035, 0.032, 0.030, 1.0)
        bg.inputs[1].default_value = 1.0
    return made


def render(path, res_x=1280, samples=64):
    sc = bpy.context.scene
    avail = [i.identifier for i in
             sc.render.bl_rna.properties["engine"].enum_items]
    for want in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if want in avail:
            sc.render.engine = want
            break
    try:
        sc.eevee.taa_render_samples = samples
        sc.eevee.use_shadows = True
    except AttributeError:
        pass
    sc.render.resolution_x = res_x
    sc.render.resolution_y = int(round(res_x / CAM_ASPECT))
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.render.image_settings.media_type = "IMAGE"
    except (AttributeError, TypeError):
        pass
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "AgX"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def frame_fraction(obj_name, cam_loc, tgt):
    """What fraction of the frame's WIDTH the object spans -- the number
    WORKORDER-3 states the dealer should hit (~21%)."""
    ob = bpy.data.objects.get(obj_name)
    if ob is None:
        return None
    bpy.context.view_layer.update()
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    view = (tgt - cam_loc).normalized()
    depths = [(p - cam_loc).dot(view) for p in pts]
    depth = sum(depths) / len(depths)
    half_h = depth * math.tan(math.radians(CAM_FOV / 2.0))
    half_w = half_h * CAM_ASPECT
    width = max(p.x for p in pts) - min(p.x for p in pts)
    top = max(p.z for p in pts)
    return {
        "width_frac": width / (2.0 * half_w),
        "depth": depth,
        "top_z": top,
    }
