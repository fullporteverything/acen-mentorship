"""s7_martini.py -- the Martini as authored geometry for the glb.

WORKORDER-2 priority 3.5, carried into sprint 3. The site runs a
procedural three.js glass and would rather have this one.

    Martini         glass + olive + pick, origin AT THE BASE so the site
                    can tilt it about the point it actually rests on
    MartiniLiquid   the liquid, a SEPARATE sibling node

They are siblings, not parent and child, and that is the whole point: the
site tilts the glass while keeping the liquid surface level. Parenting the
liquid to the glass would tilt it too, and welding them into one mesh would
make it impossible.

martini.py stays as it is -- that renders the Cycles sprite. This module is
the glTF-safe version: Principled only, transmission via
KHR_materials_transmission, no Cycles-only nodes.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_table as T
import s7_props as P

SEG = 48
BASE_XY = (-1.62, -0.42)          # on the felt, player's left
BASE_Z = T.SURFACE_Z

# (radius, z) from the bowl's interior centre, up the inside, over the rim,
# down the outside, along the stem and out to the foot. Both ends sit at
# r = 0 so P.revolve collapses them to single pole vertices.
GLASS = (
    (0.000, 0.404),
    (0.016, 0.408),
    (0.198, 0.616),
    (0.213, 0.624),      # rim
    (0.208, 0.612),
    (0.026, 0.388),
    (0.019, 0.372),
    (0.019, 0.030),      # stem
    (0.030, 0.020),
    (0.168, 0.008),
    (0.170, 0.000),      # foot
    (0.000, 0.000),
)

LIQUID_Z = 0.560
LIQUID = (
    (0.000, LIQUID_Z),
    (0.183, LIQUID_Z),   # surface
    (0.014, 0.406),
    (0.000, 0.402),
)


def pbr_glass(name, color, rough, ior, transmission=1.0):
    """Principled with transmission -- exports as KHR_materials_transmission."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.name = "Principled BSDF"
    b.inputs["Base Color"].default_value = color
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = rough
    for key in ("Transmission Weight", "Transmission"):
        if key in b.inputs:
            b.inputs[key].default_value = transmission
            break
    if "IOR" in b.inputs:
        b.inputs["IOR"].default_value = ior
    nt.links.new(b.outputs[0], out.inputs[0])
    m.diffuse_color = color
    m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    return m


def build_martini():
    """Returns (Martini, MartiniLiquid) -- two sibling objects."""
    glassm = pbr_glass("S7_MartiniGlass", (0.92, 0.95, 0.96, 1.0), 0.05, 1.45)
    liqm = pbr_glass("S7_MartiniLiquid", (0.86, 0.62, 0.20, 1.0), 0.10, 1.33)
    olivem = C.pbr("S7_MartiniOlive", C.srgb("#5f6b2a"), 0.0, 0.42)
    pickm = C.pbr("S7_MartiniPick", C.GOLD, 0.85, 0.28)

    glass = P.revolve("Martini", GLASS, seg=SEG)
    C.set_material(glass, glassm)
    for p in glass.data.polygons:
        p.use_smooth = True

    parts = [glass]

    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10,
                                         radius=0.036,
                                         location=(0.052, 0.0, LIQUID_Z - 0.012))
    olive = bpy.context.active_object
    olive.name = "M_Olive"
    C.set_material(olive, olivem)
    for p in olive.data.polygons:
        p.use_smooth = True
    parts.append(olive)

    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.005, depth=0.30,
                                        location=(0.085, 0.0, LIQUID_Z + 0.075),
                                        rotation=(0.0, 0.42, 0.0))
    pick = bpy.context.active_object
    pick.name = "M_Pick"
    C.set_material(pick, pickm)
    parts.append(pick)

    glass = C.join(parts, "Martini")
    glass.name = "Martini"

    liquid = P.revolve("MartiniLiquid", LIQUID, seg=SEG)
    liquid.name = "MartiniLiquid"
    C.set_material(liquid, liqm)
    for p in liquid.data.polygons:
        p.use_smooth = True

    # siblings at the same spot -- NOT parented, so the site can tilt the
    # glass and leave the liquid level
    for ob in (glass, liquid):
        ob.location = (BASE_XY[0], BASE_XY[1], BASE_Z)

    return glass, liquid


def _main():
    C.clear_scene()
    g, l = build_martini()
    bpy.context.view_layer.update()
    print("Martini      ", [round(v, 3) for v in g.dimensions])
    print("MartiniLiquid", [round(v, 3) for v in l.dimensions],
          "parent:", l.parent)
    print("tris:", C.tri_count())


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_martini"))
