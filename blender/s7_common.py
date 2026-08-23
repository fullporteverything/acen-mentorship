"""s7_common.py — Suite 7 shared helpers.

Imported by the other build scripts. Nothing here touches the scene on
import; call the functions.

Brand palette (WORKORDER):
    gold      #e3c071 / #f7e8ac / #b8934a
    crimson   #b21d3b
    near-black#171207     felt #0d0a06     cream #F5F0F0
No pink/rose anywhere.
"""

import os
import sys
import math
import traceback

import bpy

# ── paths ────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
FONT_DIR = r"C:\Windows\Fonts"
GEORGIA = os.path.join(FONT_DIR, "georgiab.ttf")
SEGUISYM = os.path.join(FONT_DIR, "seguisym.ttf")   # ♠♥♦♣ U+2660.. and ϕ U+03D5


def ensure_out():
    os.makedirs(OUT, exist_ok=True)
    return OUT


def outpath(name):
    return os.path.join(ensure_out(), name)


# ── colour ───────────────────────────────────────────────────────────────
def srgb(hexstr):
    """'#e3c071' -> linear RGBA tuple. Blender colour sockets are linear."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


GOLD = srgb("#e3c071")
GOLD_HI = srgb("#f7e8ac")
GOLD_DK = srgb("#b8934a")
CRIMSON = srgb("#b21d3b")
NEARBLACK = srgb("#171207")
FELT = srgb("#0d0a06")
CREAM = srgb("#F5F0F0")


# ── materials (Principled only — glTF PBR, no Cycles-only nodes) ─────────
def pbr(name, color, metallic=0.0, rough=0.5, emission=None, emit_strength=0.0):
    """A glTF-safe Principled material. Reuses by name if it already exists."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.name = "Principled BSDF"
    b.inputs["Base Color"].default_value = color
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emission is not None and "Emission Color" in b.inputs:
        b.inputs["Emission Color"].default_value = emission
        b.inputs["Emission Strength"].default_value = emit_strength
    nt.links.new(b.outputs[0], out.inputs[0])
    return m


def set_material(obj, mat):
    """Single-slot assign. Booleans/bevels leave an empty slot at index 0 —
    clearing first is the fix for the white-object gotcha."""
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


# ── object helpers ───────────────────────────────────────────────────────
def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                 bpy.data.actions, bpy.data.fonts):
        for blk in list(coll):
            if blk.users == 0:
                coll.remove(blk)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def apply_mod(obj, mod):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    return j


def ngon(name, points2d, z=0.0):
    """Filled polygon from an ordered list of (x, y). Returns a mesh object."""
    me = bpy.data.meshes.new(name + "_me")
    verts = [(x, y, z) for x, y in points2d]
    me.from_pydata(verts, [], [list(range(len(verts)))])
    me.update()
    return link(bpy.data.objects.new(name, me))


def poly_curve(name, points2d, z=0.0, depth=0.0, resolution=4, cyclic=True):
    """Poly curve through points; depth>0 gives it a round swept profile —
    this is how the padded rail and the gold piping are made (handles the
    concave dealer notch correctly, which a naive scale-offset would not)."""
    cu = bpy.data.curves.new(name + "_cu", type="CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(points2d) - 1)
    for i, (x, y) in enumerate(points2d):
        sp.points[i].co = (x, y, z, 1.0)
    sp.use_cyclic_u = cyclic
    cu.bevel_depth = depth
    cu.bevel_resolution = resolution
    cu.resolution_u = 1
    return link(bpy.data.objects.new(name, cu))


def to_mesh(obj):
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def glyph(body, font_path, name, height, mat=None, extrude=0.004,
          resolution_u=2, align_y="CENTER"):
    """Text -> mesh, centred on the GLYPH INK not the font em-box.

    align_y='CENTER' alone centres on the em-box, which is why the coin's
    phi looked off-centre. Converting to mesh then origin_set(BOUNDS) is
    the fix. resolution_u is kept low to stay inside the tri budget."""
    cu = bpy.data.curves.new(name + "_cu", type="FONT")
    cu.body = body
    if font_path and os.path.isfile(font_path):
        try:
            cu.font = bpy.data.fonts.load(font_path)
        except RuntimeError:
            print("WARN: could not load font", font_path)
    else:
        print("WARN: font missing:", font_path)
    cu.size = 1.0
    cu.align_x = "CENTER"
    cu.align_y = align_y
    cu.extrude = extrude
    cu.resolution_u = resolution_u
    ob = link(bpy.data.objects.new(name, cu))
    ob = to_mesh(ob)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    h = ob.dimensions.y
    if h > 1e-6:
        s = height / h
        ob.scale = (s, s, s)
        bpy.ops.object.transform_apply(scale=True)
    if mat is not None:
        set_material(ob, mat)
    return ob


def tri_count():
    total = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ob.evaluated_get(dg).to_mesh_clear()
    return total


# ── run guard: always leave a traceback behind ───────────────────────────
def run(main_fn, tag):
    """Wrap a script's main(). On failure writes out/TRACEBACK_<tag>.txt so a
    headless crash is never silent — the thing that cost us the last run."""
    try:
        main_fn()
        print(f"[{tag}] OK")
        return 0
    except Exception:
        ensure_out()
        p = os.path.join(OUT, f"TRACEBACK_{tag}.txt")
        with open(p, "w", encoding="utf-8") as fh:
            traceback.print_exc(file=fh)
        traceback.print_exc()
        print(f"[{tag}] FAILED -> {p}")
        return 1
