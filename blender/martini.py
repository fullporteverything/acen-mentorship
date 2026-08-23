# martini.py (OPTIONAL) — 3D martini glass + olive for a future site upgrade
#
# The site currently draws its martini as SVG with a 2D slosh sim; this script
# builds the real 3D version for when we swap it in (render a transparent
# sprite now, or export .glb later for live three.js).
#
# Run in a NEW scene. Renders //renders/martini.png (transparent, portrait).
# Uses Cycles glass — on the 3060/OptiX this is seconds, and glass is the
# whole point of a martini. A Light Path "Is Camera Ray" world trick keeps the
# background transparent-black while still giving the glass something to
# reflect (the same trick that made the coin's gold read as metal).

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C

# was hard-coded at ...\Downloads\suite7\out\ -- a DIFFERENT project, so
# every run wrote outside this build (the same bug card7.py carried)
OUT = C.outpath("martini.png")

# Glass silhouette (radius, z) — cone bowl, thin stem, foot.
PROFILE = [
    (0.000, 0.000),   # center of foot
    (0.420, 0.000),   # foot edge
    (0.430, 0.015),
    (0.060, 0.040),   # foot → stem
    (0.045, 0.060),
    (0.045, 0.950),   # stem
    (0.060, 0.980),
    (0.520, 1.560),   # bowl cone outer
    (0.540, 1.585),   # rim
    (0.505, 1.575),   # rim inner lip
    (0.030, 1.010),   # bowl inner (glass thickness)
]
LIQUID_LEVEL = 1.42   # z of the liquid surface (inside the cone)


def material_glass():
    m = bpy.data.materials.new("MartiniGlass")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.03
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Base Color"].default_value = (0.92, 0.95, 0.96, 1)
    return m


def material_liquid():
    m = bpy.data.materials.new("MartiniLiquid")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["IOR"].default_value = 1.33
    # pale gold — reads "martini", matches the site palette
    bsdf.inputs["Base Color"].default_value = (0.86, 0.62, 0.20, 1)
    return m


def material_olive():
    m = bpy.data.materials.new("Olive")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.35, 0.42, 0.12, 1)
    bsdf.inputs["Roughness"].default_value = 0.35
    return m


def main():
    C.clear_scene()

    # Glass: profile polyline spun with a Screw modifier.
    mesh = bpy.data.meshes.new("glass_profile")
    verts = [(r, 0.0, z) for r, z in PROFILE]
    edges = [(i, i + 1) for i in range(len(verts) - 1)]
    mesh.from_pydata(verts, edges, [])
    glass = bpy.data.objects.new("Glass", mesh)
    bpy.context.scene.collection.objects.link(glass)
    screw = glass.modifiers.new("spin", "SCREW")
    screw.axis = "Z"
    screw.steps = 96
    screw.use_smooth_shade = True
    bpy.ops.object.select_all(action="DESELECT")
    glass.select_set(True)
    bpy.context.view_layer.objects.active = glass
    bpy.ops.object.modifier_apply(modifier=screw.name)
    glass.data.materials.append(material_glass())

    # Liquid: a cone matching the bowl interior up to LIQUID_LEVEL.
    # Bowl interior is ~linear from (0.03,1.01) to (0.505,1.575).
    t = (LIQUID_LEVEL - 1.01) / (1.575 - 1.01)
    r_top = 0.03 + t * (0.505 - 0.03) - 0.006  # small inset so it never z-fights
    bpy.ops.mesh.primitive_cone_add(
        vertices=96, radius1=0.024, radius2=r_top,
        depth=LIQUID_LEVEL - 1.01, location=(0, 0, (1.01 + LIQUID_LEVEL) / 2),
    )
    liquid = bpy.context.active_object
    liquid.name = "Liquid"
    liquid.data.materials.append(material_liquid())

    # Olive on a pick, leaning in the bowl.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.085, location=(0.10, 0, LIQUID_LEVEL - 0.04))
    olive = bpy.context.active_object
    olive.name = "Olive"
    olive.data.materials.append(material_olive())
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.008, depth=0.62, location=(0.16, 0, LIQUID_LEVEL + 0.16),
        rotation=(0.0, 0.45, 0.0),
    )
    pick = bpy.context.active_object
    pick.name = "Pick"
    pick.data.materials.append(material_glass())

    # World: black to camera, soft grey to reflections (metal/glass trick).
    world = bpy.data.worlds.new("MartiniWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    mix = nt.nodes.new("ShaderNodeMixShader")
    lp = nt.nodes.new("ShaderNodeLightPath")
    dark = nt.nodes.new("ShaderNodeBackground")
    dark.inputs["Color"].default_value = (0, 0, 0, 1)
    lit = nt.nodes.new("ShaderNodeBackground")
    lit.inputs["Strength"].default_value = 1.7
    # A FLAT grey here is what the coin used, and it is wrong for glass:
    # metal only needs something bright to reflect, but glass is read
    # through, so a uniform environment refracts to a uniform wash and the
    # bowl comes out looking like opaque plastic. A vertical gradient gives
    # refraction something with structure to bend.
    texco = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.6
    mr.inputs["From Max"].default_value = 0.9
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.015, 0.013, 0.010, 1.0)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (1.0, 0.96, 0.86, 1.0)
    mid = cr.elements.new(0.42)
    mid.color = (0.20, 0.18, 0.15, 1.0)
    nt.links.new(texco.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], lit.inputs["Color"])
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(lit.outputs[0], mix.inputs[1])   # reflections see light
    nt.links.new(dark.outputs[0], mix.inputs[2])  # camera sees black/alpha
    nt.links.new(mix.outputs[0], out.inputs[0])

    # Key light.
    bpy.ops.object.light_add(type="AREA", location=(1.6, -1.4, 2.6))
    key = bpy.context.active_object
    key.data.energy = 220
    key.data.size = 2.2
    key.rotation_euler = (0.7, 0.35, 0.9)

    # rim from behind: on a transparent film the silhouette has no backdrop
    # to separate it from, so the edges need their own highlight
    bpy.ops.object.light_add(type="AREA", location=(-1.5, 2.2, 1.9))
    rim = bpy.context.active_object
    rim.data.energy = 320
    rim.data.size = 2.6
    rim.rotation_euler = (1.15, 0.0, -2.5)

    # Camera — portrait, slight downward tilt.
    bpy.ops.object.camera_add(location=(0, -3.1, 1.25), rotation=(1.47, 0, 0))
    cam = bpy.context.active_object
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    # push it onto the 3060 -- Cycles defaults to CPU and glass is the whole
    # point of this render
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = backend
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type == backend for d in prefs.devices):
                for d in prefs.devices:
                    d.use = (d.type == backend)
                scene.cycles.device = "GPU"
                break
    except Exception as exc:
        print("WARN: falling back to CPU Cycles (%s)" % exc)
    scene.cycles.samples = 320
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 1024
    # Blender 5.2 gates the format enum on media_type -- set it to IMAGE
    # first or 'PNG' is not in the enum yet and this throws
    try:
        scene.render.image_settings.media_type = "IMAGE"
    except (AttributeError, TypeError):
        pass
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)

    print(f"Done: {OUT}")


main()
