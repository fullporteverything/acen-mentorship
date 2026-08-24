"""s7_table5.py -- Table5, the five-seat variant.

WORKORDER-2 P3: "a wider variant (~7.4 x 3.9) of the SAME design with FIVE
subtle betting circles fanned along the player arc (center one identical to
Table's). Same felt print. Keep the original Table untouched."

Deliberately a SEPARATE module that imports s7_table rather than a
refactor of it. build_table() is what produced the Table already shipped
and wired into the site; the surest way to keep it untouched is not to
edit the file at all. Everything structural -- outline(), slab(), tube(),
arc_text(), flat_text(), the inset maths -- is reused, so the two tables
cannot drift apart in style.

Furniture (Shoe, ChipTray, DiscardTray) is NOT moved. Table5 grows around
it, so the site swaps ONE mesh and repositions nothing. That is also why
the tray recess is cut at the same place.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_table as T

# ~7.4 x 3.9. Y_BACK stays DEPTH/2 as on Table, so the dealer notch simply
# moves back and the dealer gets more room.
HALF_W = 3.7
DEPTH = 3.9
Y_BACK = 1.95

SEATS = 5
SEAT_SPREAD = 30.0     # degrees of ellipse parameter between adjacent seats

# Table5 is 0.4 deeper than Table, so the inherited print is lifted by this
# much. The CONTENT and the curvature are identical -- only the arc centre
# moves, so radii are untouched -- but leaving it at Table's height put the
# seat-1 and seat-3 circles straight through the insurance row.
PRINT_DY = 0.20
# Each circle this far in from the felt's FRONT EDGE, along the edge normal.
# Table5's inner outline bottoms out at y = (Y_BACK - RAIL_W) - (DEPTH - 2*RAIL_W)
# = -1.69, so the inset that lands the centre seat on Table's (0, -0.90) is
# 0.79. Deriving it from Y_BACK - DEPTH instead put the centre at -1.16.
# = 0.79, derived rather than typed so it tracks the table dimensions.
BET_INSET = abs((Y_BACK - T.RAIL_W) - (DEPTH - 2 * T.RAIL_W)) + T.BET_CIRCLE[1]
BET_R = T.BET_CIRCLE[2]


def outlines5():
    """outer / felt / rail-centreline at Table5 size, same inset maths."""
    k = T.RAIL_W
    outer = T.outline(HALF_W, DEPTH, Y_BACK, T.NOTCH_RX, T.NOTCH_RY)
    inner = T.outline(HALF_W - k, DEPTH - 2 * k, Y_BACK - k,
                      T.NOTCH_RX + k, T.NOTCH_RY + k, notch_cy=Y_BACK)
    railmid = T.outline(HALF_W - k / 2, DEPTH - k, Y_BACK - k / 2,
                        T.NOTCH_RX + k / 2, T.NOTCH_RY + k / 2,
                        notch_cy=Y_BACK)
    return outer, inner, railmid


def felt_edge(t):
    """Point on the felt's front edge, and the inward unit normal there.

    t is the ellipse parameter, 270 deg = the middle of the player arc.
    The normal of an ellipse is NOT the radial direction -- it is
    (cos t / a, sin t / b) normalised -- which matters here because the
    arc is much flatter at the ends than a circle would be.
    """
    k = T.RAIL_W
    a, b = HALF_W - k, DEPTH - 2 * k
    yb = Y_BACK - k
    ct, st = math.cos(t), math.sin(t)
    p = (a * ct, yb + b * st)
    nx, ny = ct / a, st / b
    n = math.hypot(nx, ny) or 1.0
    return p, (-nx / n, -ny / n)          # inward


def bet_circles():
    """Five circles fanned along the player arc, evenly spaced, each the
    same distance in from the felt edge. The centre one lands on Table's
    (0, -0.90) exactly, which is what 'identical to Table's' requires."""
    out = []
    for i in range(-(SEATS // 2), SEATS // 2 + 1):
        t = math.radians(270.0 + SEAT_SPREAD * i)
        (px, py), (nx, ny) = felt_edge(t)
        out.append((px + nx * BET_INSET, py + ny * BET_INSET, BET_R))
    return out


def layout_check(circles):
    """The felt print is inherited unchanged from Table, so the circles have
    to be the ones that get out of its way. Returns complaints; empty is
    good."""
    bad = []
    k = T.RAIL_W
    a, b, yb = HALF_W - k, DEPTH - 2 * k, Y_BACK - k

    # printed rows, as conservative boxes
    boxes = []
    for txt, y, h in T.FELT_ROWS:
        y = y + PRINT_DY
        r = T.PRINT_CY - (y - PRINT_DY)
        n = len(txt)
        half = (h * 0.92 / r) * (n - 1) / 2.0
        boxes.append((abs(r * math.sin(half)) + 0.04, y - h / 2 - 0.03,
                      y + h / 2 + 0.03))
    wx, wy, wh = T.WORDMARK
    wy = wy + PRINT_DY
    boxes.append((0.42, wy - wh / 2 - 0.03, wy + wh / 2 + 0.03))

    for i, (cx, cy, r) in enumerate(circles):
        # on the felt?
        if abs(cx) + r > a:
            bad.append("circle %d runs off the side" % i)
        frac = 1.0 - (cx / a) ** 2
        edge = yb - b * math.sqrt(max(0.0, frac))
        if cy - r < edge:
            bad.append("circle %d overhangs the felt edge by %.3f"
                       % (i, edge - (cy - r)))
        # clear of the print?
        for hx, y0, y1 in boxes:
            if abs(cx) - r < hx and not (cy + r < y0 or cy - r > y1):
                bad.append("circle %d overlaps a printed row" % i)
                break
        # clear of each other?
        for j in range(i + 1, len(circles)):
            ox, oy, orr = circles[j]
            if math.hypot(cx - ox, cy - oy) < r + orr:
                bad.append("circles %d and %d overlap" % (i, j))
    return bad


def build_table5(name="Table5"):
    """Returns the Table5 object. Furniture is untouched."""
    mat_felt = C.pbr("S7_Felt", C.FELT, 0.0, 0.92)
    mat_rail = C.pbr("S7_Rail", C.srgb("#231a10"), 0.0, 0.55)
    mat_gold = C.pbr("S7_TableGold", C.GOLD, 0.85, 0.26)
    mat_print = C.pbr("S7_FeltPrint", C.GOLD_DK, 0.30, 0.60)
    mat_pocket = C.pbr("S7_TrayPocket", C.srgb("#0a0805"), 0.0, 0.70)

    circles = bet_circles()
    bad = layout_check(circles)
    if bad:
        raise RuntimeError("Table5 felt layout: " + "; ".join(bad))

    outer, inner, railmid = outlines5()

    parts = []
    parts.append(T.slab("T5Body", outer, 0.0, T.SLAB_H, mat_rail))
    parts.append(T.slab("T5Felt", inner, T.SURFACE_Z, 0.012, mat_felt))
    parts.append(T.tube("T5Trim", inner, T.SURFACE_Z + 0.004, 0.010, mat_gold))
    parts.append(T.tube("T5Rail", railmid, 0.012, T.RAIL_W * 0.50, mat_rail,
                        res=5))

    for i, (bx, by, br) in enumerate(circles):
        pts = [(bx + br * math.cos(2 * math.pi * s / 64),
                by + br * math.sin(2 * math.pi * s / 64)) for s in range(64)]
        parts.append(T.tube("T5Bet%d" % i, pts, T.SURFACE_Z + 0.003, 0.012,
                            mat_gold))

    if T.FELT_PRINT:                       # identical print to Table
        wx, wy, wh = T.WORDMARK
        parts.append(T.flat_text("SUITE 7", wx, wy + PRINT_DY, wh, mat_print,
                                 name="T5Wordmark"))
        for txt, y, size in T.FELT_ROWS:
            # same radius, centre raised -> same curve, 0.20 higher
            arc = T.arc_text(txt, T.PRINT_CY - y, T.PRINT_CY + PRINT_DY, size,
                             mat_print, name="T5Print_" + txt.split()[0])
            if arc:
                parts.append(arc)

    table = C.join(parts, name)
    table.name = name

    # same pocket, same place, so ChipTray needs no repositioning
    T.cut_tray_recess(table, mat_pocket)
    empties, bad_polys = T.material_audit(table)
    if empties or bad_polys:
        raise RuntimeError("Table5 boolean left %d empty slot(s), %d bad polys"
                           % (len(empties), bad_polys))
    return table


def _main():
    C.clear_scene()
    t = build_table5()
    print("Table5 dims:", [round(v, 3) for v in t.dimensions])
    for i, c in enumerate(bet_circles()):
        print("  seat %d at (%+.3f, %+.3f) r %.2f" % (i, c[0], c[1], c[2]))
    print("tris:", C.tri_count())


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_table5"))
