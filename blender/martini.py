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

import bpy

OUT = bpy.path.abspath("//renders/martini.png")

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
    bsdf.inputs["Base Color"].default_value = (0.93, 0.85, 0.62, 1)
    return m


def material_olive():
    m = bpy.data.materials.new("Olive")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.35, 0.42, 0.12, 1)
    bsdf.inputs["Roughness"].default_value = 0.35
    return m


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

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
    lit.inputs["Color"].default_value = (0.7, 0.68, 0.6, 1)
    lit.inputs["Strength"].default_value = 1.2
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

    # Camera — portrait, slight downward tilt.
    bpy.ops.object.camera_add(location=(0, -3.1, 1.25), rotation=(1.47, 0, 0))
    cam = bpy.context.active_object
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 160
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)

    print(f"Done: {OUT}")


main()
