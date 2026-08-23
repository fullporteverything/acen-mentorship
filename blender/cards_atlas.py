# cards_atlas.py — render the full 52-card face atlas (+ back)
#
# Starting point for OVERNIGHT Phase 4. Renders every rank×suit card face
# (toon-styled, gold ♠♣ / crimson ♥♦) plus the card back into per-cell PNGs,
# then stitches them into  //renders/cards-atlas.png  using Blender's own
# image pixel API (no PIL needed).
#
# Atlas contract (GAME-MANIFEST §6 — the site depends on this layout):
#   columns: A,2,3,4,5,6,7,8,9,10,J,Q,K   (13, left→right)
#   rows:    ♠,♥,♦,♣                       (4, top→bottom)
#   back:    row 5, column 1
#   uniform cells; final image ≤ 4096².
#
# Cell size 256×372 → atlas 3328×1860 (fits). Rendering uses a flat ortho
# camera over a card-face "flat" built from planes + text meshes; each cell
# re-writes the two glyph objects and re-renders. ~53 renders at 256×372 on
# EEVEE is a couple of minutes total.

import math
import os

import bpy

GEORGIA = r"C:\Windows\Fonts\georgiab.ttf"
SEGUISYM = r"C:\Windows\Fonts\seguisym.ttf"
OUTDIR = bpy.path.abspath("//renders/atlas_cells")
ATLAS = bpy.path.abspath("//renders/cards-atlas.png")

CELL_W, CELL_H = 256, 372
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = [("\u2660", "gold"), ("\u2665", "crimson"), ("\u2666", "crimson"), ("\u2663", "gold")]
COLS, ROWS = len(RANKS), len(SUITS) + 1  # +1 row for the back

GOLD = (0.890, 0.753, 0.443, 1)
GOLD_HI = (0.969, 0.910, 0.675, 1)
CRIMSON = (0.698, 0.114, 0.231, 1)
FACE = (0.020, 0.014, 0.008, 1)

CARD_W, CARD_H = 0.62, 0.90


def emission(name, color):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    e = n.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = color
    m.node_tree.links.new(e.outputs[0], out.inputs[0])
    return m


def text_obj(name, body, font, height, mat, loc, rot_z=0.0):
    curve = bpy.data.curves.new(type="FONT", name=name + "_c")
    curve.body = body
    try:
        curve.font = bpy.data.fonts.load(font)
    except RuntimeError:
        pass
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
    obj.location = loc
    obj.rotation_euler = (0, 0, rot_z)
    return obj


def build_stage():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    # Face plane (the card ground) — gold border via a slightly larger plane.
    bpy.ops.mesh.primitive_plane_add(size=1)
    border = bpy.context.active_object
    border.scale = (CARD_W / 2 + 0.012, CARD_H / 2 + 0.012, 1)
    border.data.materials.append(emission("A_Gold", GOLD))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.001))
    ground = bpy.context.active_object
    ground.scale = (CARD_W / 2, CARD_H / 2, 1)
    ground.data.materials.append(emission("A_Face", FACE))
    # Ortho camera framing exactly the border.
    bpy.ops.object.camera_add(location=(0, 0, 2), rotation=(0, 0, 0))
    cam = bpy.context.active_object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = CARD_H + 0.03
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.resolution_x = CELL_W
    scene.render.resolution_y = CELL_H
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"


GLYPHS = []  # rebuilt per cell


def clear_glyphs():
    global GLYPHS
    for o in GLYPHS:
        bpy.data.objects.remove(o, do_unlink=True)
    GLYPHS = []


def render_face(rank, suit_char, tint_name, path):
    clear_glyphs()
    tint = emission("A_Gold", GOLD) if tint_name == "gold" else emission("A_Crimson", CRIMSON)
    hi = emission("A_GoldHi", GOLD_HI)
    z = 0.01
    ix, iy = CARD_W / 2 - 0.075, CARD_H / 2 - 0.085
    GLYPHS.append(text_obj("g_center", suit_char, SEGUISYM, 0.30, tint, (0, 0.0, z)))
    GLYPHS.append(text_obj("g_r_tl", rank, GEORGIA, 0.085, hi, (-ix, iy, z)))
    GLYPHS.append(text_obj("g_s_tl", suit_char, SEGUISYM, 0.055, tint, (-ix, iy - 0.085, z)))
    GLYPHS.append(text_obj("g_r_br", rank, GEORGIA, 0.085, hi, (ix, -iy, z), math.pi))
    GLYPHS.append(text_obj("g_s_br", suit_char, SEGUISYM, 0.055, tint, (ix, -iy + 0.085, z), math.pi))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_back(path):
    clear_glyphs()
    GLYPHS.append(text_obj("g_back", "\u2660", SEGUISYM, 0.30, emission("A_Gold", GOLD), (0, 0, 0.01)))
    GLYPHS.append(text_obj("g_back7", "7", GEORGIA, 0.12, emission("A_GoldHi", GOLD_HI), (0, -0.28, 0.01)))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def stitch():
    atlas = bpy.data.images.new("cards-atlas", COLS * CELL_W, ROWS * CELL_H, alpha=True)
    big = [0.0] * (COLS * CELL_W * ROWS * CELL_H * 4)
    AW = COLS * CELL_W

    def paste(img_path, col, row):
        img = bpy.data.images.load(img_path)
        px = list(img.pixels)
        # Blender images are bottom-up; row 0 of the atlas = TOP row.
        y0 = (ROWS - 1 - row) * CELL_H
        x0 = col * CELL_W
        for y in range(CELL_H):
            src = y * CELL_W * 4
            dst = ((y0 + y) * AW + x0) * 4
            big[dst:dst + CELL_W * 4] = px[src:src + CELL_W * 4]
        bpy.data.images.remove(img)

    for r, (suit, tint) in enumerate(SUITS):
        for c, rank in enumerate(RANKS):
            paste(os.path.join(OUTDIR, f"{rank}{r}.png"), c, r)
    paste(os.path.join(OUTDIR, "back.png"), 0, 4)

    atlas.pixels = big
    atlas.filepath_raw = ATLAS
    atlas.file_format = "PNG"
    atlas.save()


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    build_stage()
    for r, (suit, tint) in enumerate(SUITS):
        for rank in RANKS:
            render_face(rank, suit, tint, os.path.join(OUTDIR, f"{rank}{r}.png"))
    render_back(os.path.join(OUTDIR, "back.png"))
    stitch()
    print(f"Done: {ATLAS} ({COLS*CELL_W}x{ROWS*CELL_H})")


main()
