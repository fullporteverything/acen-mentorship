"""cards_atlas.py -- out/cards-atlas.png, all 52 faces + the back.

PLAIN PYTHON, not bpy. Run with the system interpreter:

    python blender/cards_atlas.py

Rendering 52 cards through Blender would mean 52 scene builds for something
that is fundamentally 2D typography; Pillow gives exact glyph control and
runs in about a second.

Grid: 13 columns x 5 rows of uniform 256 x 372 cells -> 3328 x 1860 RGBA.
    columns  A 2 3 4 5 6 7 8 9 10 J Q K
    rows     spades, hearts, diamonds, clubs, then row 5 col 1 = the back
    (rest of row 5 is left transparent)

Style is held to out/card.png: warm near-black face, double gold border,
mirrored corner indices, classic centre pip layouts.

Geometry is expressed in the SAME card units as s7_props.build_card()
(0.62 x 0.90, corner radius 0.045, borders inset 0.034 / 0.055) and scaled
into the cell, so the atlas and the 3D card cannot drift apart.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

GEORGIA = r"C:\Windows\Fonts\georgiab.ttf"
SEGUISYM = r"C:\Windows\Fonts\seguisym.ttf"

# -- grid ----------------------------------------------------------------
CELL_W, CELL_H = 256, 372
COLS, ROWS = 13, 5
SS = 3                                   # supersample; ImageDraw shapes are
                                         # not antialiased, text alone is
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
SUITS = (("S", "\u2660"), ("H", "\u2665"), ("D", "\u2666"), ("C", "\u2663"))

# -- palette (no pink/rose) ----------------------------------------------
FACE = "#171207"
BACK_GROUND = "#241a0c"
GOLD = "#e3c071"
GOLD_DK = "#b8934a"
CRIMSON = "#b21d3b"
FAINT = "#5d4926"
RED_SUITS = {"H", "D"}

# -- card units (identical to s7_props.build_card) -----------------------
CARD_W, CARD_H = 0.62, 0.90
CARD_R = 0.045
BORDER_OUT, BORDER_IN = 0.034, 0.055
LINE_OUT, LINE_IN = 0.0072, 0.0034      # drawn stroke widths

# The index block and the pip columns must not overlap HORIZONTALLY --
# vertical overlap is normal on a real card, horizontal is a collision.
# The binding case is "10", by far the widest rank: at the first sizing it
# ran from -0.240 to -0.130 straight through the left pip column, which
# started at -0.160. LAYOUT_SLACK below is asserted at build time.
IDX_LEFT = -CARD_W / 2 + 0.062          # left edge of the index block
IDX_RANK_Y = 0.335
IDX_PIP_Y = 0.252
IDX_RANK_H = 0.066
IDX_PIP_H = 0.046

PIP_COL_X = 0.112                       # centre-layout column offset
PIP_ROW_Y = 0.255                       # row 1.0 -> this y
PIP_H = 0.098
PIP_H_DENSE = 0.090                     # 9 and 10 carry four rows of pairs
DENSE = ("9", "10")
LAYOUT_SLACK = 0.004                    # minimum index-to-pip gap, card units
ACE_H = 0.300
COURT_H = 0.260
COURT_PIP_H = 0.135

# (column, row) with column -1/0/+1 and row in [-1, 1]. Pips below the
# midline are drawn rotated 180, as on a real card.
THIRD = 1.0 / 3.0
LAYOUTS = {
    "A":  [(0, 0.0)],
    "2":  [(0, 1.0), (0, -1.0)],
    "3":  [(0, 1.0), (0, 0.0), (0, -1.0)],
    "4":  [(-1, 1.0), (1, 1.0), (-1, -1.0), (1, -1.0)],
    "5":  [(-1, 1.0), (1, 1.0), (0, 0.0), (-1, -1.0), (1, -1.0)],
    "6":  [(-1, 1.0), (1, 1.0), (-1, 0.0), (1, 0.0), (-1, -1.0), (1, -1.0)],
    "7":  [(-1, 1.0), (1, 1.0), (0, 0.5), (-1, 0.0), (1, 0.0),
           (-1, -1.0), (1, -1.0)],
    "8":  [(-1, 1.0), (1, 1.0), (0, 0.5), (-1, 0.0), (1, 0.0),
           (0, -0.5), (-1, -1.0), (1, -1.0)],
    "9":  [(-1, 1.0), (1, 1.0), (-1, THIRD), (1, THIRD), (0, 0.0),
           (-1, -THIRD), (1, -THIRD), (-1, -1.0), (1, -1.0)],
    "10": [(-1, 1.0), (1, 1.0), (0, 2 * THIRD), (-1, THIRD), (1, THIRD),
           (0, -2 * THIRD), (-1, -THIRD), (1, -THIRD), (-1, -1.0), (1, -1.0)],
}


# -- helpers -------------------------------------------------------------
def ink_bbox(text, font):
    d = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    return d.textbbox((0, 0), text, font=font)


def font_for_ink(path, text, target_px, iters=3):
    """A font size whose INK height for `text` is target_px.

    Sizing by ink, not by nominal point size, because Georgia ships
    OLD-STYLE figures -- 3 4 5 7 9 descend and 1 2 are x-height -- so equal
    point sizes give visibly unequal ranks. Normalising ink height is also
    exactly what C.glyph does for the 3D card, which keeps the two in step.
    """
    size = max(6, int(target_px * 1.6))
    for _ in range(iters):
        f = ImageFont.truetype(path, size)
        bb = ink_bbox(text, f)
        h = bb[3] - bb[1]
        if h <= 0:
            return f
        nxt = max(6, int(round(size * target_px / h)))
        if nxt == size:
            break
        size = nxt
    return ImageFont.truetype(path, size)


def render_ink(text, font, fill):
    """Text rendered into an RGBA image cropped exactly to its ink."""
    bb = ink_bbox(text, font)
    w, h = max(1, bb[2] - bb[0]), max(1, bb[3] - bb[1])
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((-bb[0], -bb[1]), text, font=font, fill=fill)
    return img


def render_rank(rank, ink, target_px, max_px):
    """Set a rank glyph-by-glyph, each cropped to its ink and butted with
    tight tracking.

    "10" as a plain string measures 0.142 card units against an index
    budget of ~0.084 -- and most of that excess is per-glyph sidebearing,
    which a corner index does not need. Cropping each digit to ink and
    butting them recovers nearly all of it, so "10" stays almost the same
    size as every other rank instead of being shrunk to fit. If it still
    will not fit, the whole block scales down rather than running into the
    pip column.
    """
    def compose(h):
        gap = max(1, int(round(h * 0.06)))
        imgs = [render_ink(ch, font_for_ink(GEORGIA, ch, h), ink)
                for ch in rank]
        w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
        hh = max(i.height for i in imgs)
        out = Image.new("RGBA", (w, hh), (0, 0, 0, 0))
        x = 0
        for i in imgs:
            out.alpha_composite(i, (x, hh - i.height))   # common baseline
            x += i.width + gap
        return out

    # Iterate: font sizes are integers, so a single proportional rescale
    # can still land a pixel or two over budget.
    h = float(target_px)
    img = compose(h)
    for _ in range(5):
        if img.width <= max_px or img.width <= 0:
            break
        h = max(6.0, h * (max_px / float(img.width)) * 0.98)
        img = compose(h)
    return img


def stamp(base, img, cx, cy, rotate=0):
    if rotate:
        img = img.rotate(rotate, expand=True, resample=Image.BICUBIC)
    base.alpha_composite(img, (int(round(cx - img.width / 2.0)),
                               int(round(cy - img.height / 2.0))))


class Cell(object):
    """Maps card units -> supersampled cell pixels."""

    def __init__(self):
        self.w = CELL_W * SS
        self.h = CELL_H * SS
        self.k = self.w / CARD_W          # px per card unit
        self.img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.img)

    def px(self, x, y):
        """card (x, y) -> pixel (x right, y DOWN)"""
        return (self.w / 2.0 + x * self.k, self.h / 2.0 - y * self.k)

    def u(self, v):
        return v * self.k

    def rrect(self, inset, radius, **kw):
        x0, y0 = self.px(-CARD_W / 2 + inset, CARD_H / 2 - inset)
        x1, y1 = self.px(CARD_W / 2 - inset, -CARD_H / 2 + inset)
        self.draw.rounded_rectangle([x0, y0, x1, y1], radius=self.u(radius),
                                    **kw)

    def finish(self):
        return self.img.resize((CELL_W, CELL_H), Image.LANCZOS)


CLEARANCE = []                          # (rank, suit, index-to-pip gap)


def base_card(ground=FACE):
    c = Cell()
    c.rrect(0.0, CARD_R, fill=ground)
    return c


def draw_face(rank, suit_key, pip_char):
    ink = CRIMSON if suit_key in RED_SUITS else GOLD
    c = base_card()

    c.rrect(BORDER_OUT, max(0.008, CARD_R - BORDER_OUT), outline=GOLD,
            width=max(1, int(round(c.u(LINE_OUT)))))
    c.rrect(BORDER_IN, max(0.008, CARD_R - BORDER_IN), outline=GOLD,
            width=max(1, int(round(c.u(LINE_IN)))))

    # --- corner indices -------------------------------------------------
    # Budget the index against THIS card's own pip column, so the check is
    # exact rather than a guess at font metrics.
    h_pip = PIP_H_DENSE if rank in DENSE else PIP_H
    pip_w_px = render_ink(pip_char,
                          font_for_ink(SEGUISYM, pip_char, c.u(h_pip)),
                          ink).width
    left_px = c.px(IDX_LEFT, 0)[0]
    max_px = ((c.px(-PIP_COL_X, 0)[0] - pip_w_px / 2.0)
              - c.u(LAYOUT_SLACK) - left_px)

    pip_f = font_for_ink(SEGUISYM, pip_char, c.u(IDX_PIP_H))
    rank_img = render_rank(rank, ink, c.u(IDX_RANK_H), max_px)
    pip_img = render_ink(pip_char, pip_f, ink)

    # left-align the block: "10" is far wider than "A", so centring it on a
    # fixed x pushed it through the inner border
    cx = left_px + rank_img.width / 2.0
    if rank in LAYOUTS and rank != "A":
        gap_px = (c.px(-PIP_COL_X, 0)[0] - pip_w_px / 2.0) - (left_px + rank_img.width)
        CLEARANCE.append((rank, suit_key, gap_px / c.k))
    for spin in (0, 180):
        rx, ry = (cx, c.px(0, IDX_RANK_Y)[1])
        px_, py_ = (cx, c.px(0, IDX_PIP_Y)[1])
        if spin:
            rx, ry = c.w - rx, c.h - ry
            px_, py_ = c.w - px_, c.h - py_
        stamp(c.img, rank_img, rx, ry, spin)
        stamp(c.img, pip_img, px_, py_, spin)

    # --- centre ----------------------------------------------------------
    if rank in LAYOUTS:
        h = ACE_H if rank == "A" else (PIP_H_DENSE if rank in DENSE else PIP_H)
        f = font_for_ink(SEGUISYM, pip_char, c.u(h))
        img = render_ink(pip_char, f, ink)
        for col, row in LAYOUTS[rank]:
            x, y = c.px(col * PIP_COL_X, row * PIP_ROW_Y)
            stamp(c.img, img, x, y, 180 if row < -1e-9 else 0)
    else:                                    # J / Q / K: big letter + pip
        limg = render_rank(rank, ink, c.u(COURT_H), c.u(0.34))
        x, y = c.px(0.0, 0.060)
        stamp(c.img, limg, x, y)
        pf = font_for_ink(SEGUISYM, pip_char, c.u(COURT_PIP_H))
        x, y = c.px(0.0, -0.210)
        stamp(c.img, render_ink(pip_char, pf, ink), x, y)

    return c.finish()


def draw_back():
    """Gold hairlines on near-black with a faint centred spade -- the same
    back as out/card.png."""
    c = base_card(BACK_GROUND)
    for inset, line in ((0.034, 0.0060), (0.050, 0.0030), (0.062, 0.0030)):
        c.rrect(inset, max(0.008, CARD_R - inset), outline=GOLD_DK,
                width=max(1, int(round(c.u(line)))))
    f = font_for_ink(SEGUISYM, "\u2660", c.u(0.34))
    x, y = c.px(0.0, 0.0)
    stamp(c.img, render_ink("\u2660", f, FAINT), x, y)
    return c.finish()


def build(path=None):
    path = path or os.path.join(OUT, "cards-atlas.png")
    os.makedirs(OUT, exist_ok=True)
    atlas = Image.new("RGBA", (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))

    del CLEARANCE[:]
    for r, (key, pip) in enumerate(SUITS):
        for col, rank in enumerate(RANKS):
            atlas.paste(draw_face(rank, key, pip),
                        (col * CELL_W, r * CELL_H))
    atlas.paste(draw_back(), (0, 4 * CELL_H))

    tight = [c for c in CLEARANCE if c[2] < LAYOUT_SLACK]
    worst = min(CLEARANCE, key=lambda c: c[2]) if CLEARANCE else None
    if worst:
        print("  tightest index/pip gap: %s%s = %+.4f (min %+.4f)"
              % (worst[0], worst[1], worst[2], LAYOUT_SLACK))
    if tight:
        raise SystemExit("INDEX COLLIDES WITH PIP COLUMN: %s"
                         % ", ".join("%s%s %+.4f" % t for t in tight[:6]))

    atlas.save(path)
    return path


def verify(path=None):
    """Assert the grid is what the site expects."""
    path = path or os.path.join(OUT, "cards-atlas.png")
    im = Image.open(path).convert("RGBA")
    problems = []
    if im.size != (COLS * CELL_W, ROWS * CELL_H):
        problems.append("size %s != %s" % (im.size, (COLS * CELL_W, ROWS * CELL_H)))
    if max(im.size) > 4096:
        problems.append("exceeds 4096 on an axis: %s" % (im.size,))

    def filled(col, row):
        """fraction of opaque pixels in a cell"""
        box = im.crop((col * CELL_W, row * CELL_H,
                       (col + 1) * CELL_W, (row + 1) * CELL_H))
        a = box.getchannel("A")
        return sum(a.histogram()[201:]) / float(CELL_W * CELL_H)

    for r in range(4):
        for col in range(COLS):
            if filled(col, r) < 0.80:
                problems.append("cell (col %d, row %d) looks empty" % (col, r))
    if filled(0, 4) < 0.80:
        problems.append("card back missing at row 5 col 1")
    for col in range(1, COLS):
        if filled(col, 4) > 0.02:
            problems.append("row 5 col %d should be transparent" % (col + 1))
    return im.size, problems


def main():
    p = build()
    size, problems = verify(p)
    print("cards-atlas.png -> %s" % p)
    print("  %d x %d, %d bytes, cells %dx%d of %dx%d"
          % (size[0], size[1], os.path.getsize(p), COLS, ROWS, CELL_W, CELL_H))
    print("  VERIFY:", "PASS" if not problems else "FAIL")
    for x in problems:
        print("   ", x)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
