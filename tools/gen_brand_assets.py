#!/usr/bin/env python3
"""Regenerate the logo SVGs and every raster icon from one source of truth.

The original `logo.png` was a 700x700, 790 KB PNG doing four jobs at once:
favicon, Open Graph image, Twitter image, and a 26-64 px mark in the nav,
footer and CTA. That is 790 KB downloaded on every page view to draw a 30 px
square, and a link preview that fails the 1.91:1 ratio.

The logo is a pixel grid, so it is exactly representable as vector art. This
script holds the grid (extracted cell-by-cell from the original raster, see
GRID below) and emits:

    assets/img/logo.svg            the full mark, faithful to the original
    assets/img/favicon.svg         the same glyph, solidified for small sizes
    assets/img/icon-192.png        PWA / Android
    assets/img/icon-512.png        PWA / Android
    assets/img/apple-touch-icon.png  180x180, opaque (iOS composites no alpha)
    favicon.ico                    16 + 32 + 48, at the root where browsers look

Rasters are rendered from the SVGs by headless Chrome (already required for the
demo tooling) and then quantised with Pillow, which keeps every icon under a
few KB.

Usage:  python3 tools/gen_brand_assets.py
"""

import pathlib
import subprocess
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# --- the mark ---------------------------------------------------------------
# 19x19 cells of a rounded-square grid; the glyph is an 'm' 13 cells wide.
# Geometry (pitch, square size, origin) measured off the original logo.png so
# that the vector version lands on the same pixels as the raster it replaces.
GRID = [
    "...................",
    "...................",
    "...................",
    "...................",
    "...YYYYYYYYYYYYY...",
    "...YYYYYYYYYYYYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...YYY..YYY..YYY...",
    "...................",
    "...................",
    "...................",
    "...................",
]

SIZE = 700.0        # canvas, matching the original raster
PITCH = 37.8333     # cell-to-cell distance
CELL = 28.0         # drawn square
RADIUS = 6.5
X0, Y0 = -4.5, -8.3333  # top-left of cell (0,0); the grid bleeds off the edges

BG = "#020421"      # the ground the grid sits on
DARK = "#152754"    # unlit cell
YELLOW = "#ffd83d"  # lit cell — the site's --yellow


def _rect(i, j, fill, radius=RADIUS, size=CELL):
    x = X0 + PITCH * i + (CELL - size) / 2
    y = Y0 + PITCH * j + (CELL - size) / 2
    return (f'<rect x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" '
            f'rx="{radius:.2f}" fill="{fill}"/>')


def logo_svg() -> str:
    """The full mark: every cell drawn, lit cells glowing. Nav, footer, CTA, OG.

    The unlit grid is a `<pattern>` rather than 300-odd rects — same picture,
    a tenth of the bytes.
    """
    lit = "".join(_rect(i, j, YELLOW)
                  for j in range(len(GRID)) for i in range(len(GRID[0]))
                  if GRID[j][i] == "Y")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700" width="700" height="700" role="img" aria-label="Miri">
  <defs>
    <pattern id="grid" x="{X0:.2f}" y="{Y0:.2f}" width="{PITCH:.4f}" height="{PITCH:.4f}" patternUnits="userSpaceOnUse">
      <rect width="{CELL:.2f}" height="{CELL:.2f}" rx="{RADIUS:.2f}" fill="{DARK}"/>
    </pattern>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="9" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="700" height="700" fill="{BG}"/>
  <rect width="700" height="700" fill="url(#grid)"/>
  <g filter="url(#glow)">{lit}</g>
</svg>
"""


def _blocks():
    """Merge lit cells into maximal rectangles.

    Bands of identical rows collapse first, then horizontal runs inside each
    band. Drawing one rect per cell instead leaves a faint antialiased seam on
    every shared edge, which is visible at icon sizes.
    """
    rows = [(j, GRID[j]) for j in range(len(GRID)) if "Y" in GRID[j]]
    out, band_start, prev = [], None, None
    bands = []
    for j, row in rows:
        if row != prev or (band_start is not None and j != bands_end + 1):
            if band_start is not None:
                bands.append((band_start, bands_end, prev))
            band_start, prev = j, row
        bands_end = j
    if band_start is not None:
        bands.append((band_start, bands_end, prev))

    for j0, j1, row in bands:
        i = 0
        while i < len(row):
            if row[i] == "Y":
                start = i
                while i < len(row) and row[i] == "Y":
                    i += 1
                out.append((start, j0, i - 1, j1))
            else:
                i += 1
    return out


def favicon_svg() -> str:
    """The glyph alone, cropped and solid.

    At 16-32 px the 13-column grid mushes into a blob: the 2-cell gaps between
    the legs are sub-pixel. So the favicon draws each lit cell at full pitch —
    adjacent cells merge into solid strokes — and crops to the glyph with one
    cell of padding. Same letterform, legible in a browser tab.
    """
    lit = [(i, j) for j in range(len(GRID)) for i in range(len(GRID[0]))
           if GRID[j][i] == "Y"]
    xs = [i for i, _ in lit]
    ys = [j for _, j in lit]
    pad = 1.15
    x = X0 + PITCH * (min(xs) - pad)
    y = Y0 + PITCH * (min(ys) - pad)
    w = PITCH * (max(xs) - min(xs) + 1 + 2 * pad)
    h = PITCH * (max(ys) - min(ys) + 1 + 2 * pad)
    side = max(w, h)                      # square viewBox, glyph centred
    x -= (side - w) / 2
    y -= (side - h) / 2
    # Blocks overlap by half a unit: abutting rects leave an antialiased hairline
    # along the shared edge, which at 32 px looks like a scratch across the glyph.
    eps = 0.5
    cells = "".join(
        f'<rect x="{X0 + PITCH * i0 - eps:.2f}" y="{Y0 + PITCH * j0 - eps:.2f}" '
        f'width="{PITCH * (i1 - i0 + 1) + 2 * eps:.2f}" '
        f'height="{PITCH * (j1 - j0 + 1) + 2 * eps:.2f}" fill="{YELLOW}"/>'
        for i0, j0, i1, j1 in _blocks())
    r = side * 0.19                       # rounded-square app-icon silhouette
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.2f} {y:.2f} {side:.2f} {side:.2f}" width="512" height="512" role="img" aria-label="Miri">
  <rect x="{x:.2f}" y="{y:.2f}" width="{side:.2f}" height="{side:.2f}" rx="{r:.2f}" fill="{BG}"/>
  <g>{cells}</g>
</svg>
"""


def render(svg_path: pathlib.Path, out: pathlib.Path, size: int) -> None:
    """Rasterise an SVG at an exact pixel size with headless Chrome."""
    with tempfile.TemporaryDirectory() as tmp:
        page = pathlib.Path(tmp) / "icon.html"
        page.write_text(
            "<!doctype html><meta charset=utf-8>"
            "<style>html,body{margin:0;padding:0;background:transparent}"
            f"img{{display:block;width:{size}px;height:{size}px}}</style>"
            f'<img src="{svg_path.resolve().as_uri()}">')
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--force-device-scale-factor=1", "--default-background-color=00000000",
             f"--window-size={size},{size}", "--virtual-time-budget=3000",
             f"--screenshot={out}", page.as_uri()],
            check=True, capture_output=True)


def squeeze(path: pathlib.Path, colors: int = 128, opaque_bg: str | None = None) -> None:
    """Palette-quantise a PNG in place; optionally flatten it onto a colour."""
    im = Image.open(path).convert("RGBA")
    if opaque_bg:
        flat = Image.new("RGBA", im.size, opaque_bg)
        flat.alpha_composite(im)
        im = flat.convert("RGB")
    # MEDIANCUT cannot quantise RGBA; FASTOCTREE handles both and keeps alpha.
    method = (Image.Quantize.MEDIANCUT if im.mode == "RGB"
              else Image.Quantize.FASTOCTREE)
    im = im.quantize(colors=colors, method=method)
    im.save(path, optimize=True)


def main() -> None:
    IMG.mkdir(parents=True, exist_ok=True)
    logo = IMG / "logo.svg"
    fav = IMG / "favicon.svg"
    logo.write_text(logo_svg())
    fav.write_text(favicon_svg())

    # PWA / Android / iOS icons come off the favicon glyph: at 192 px the full
    # grid still reads as texture rather than as a letter on a phone home screen.
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512)]:
        render(fav, IMG / name, size)
        squeeze(IMG / name)
    render(fav, IMG / "apple-touch-icon.png", 180)
    squeeze(IMG / "apple-touch-icon.png", opaque_bg=BG)

    # favicon.ico: 16/32/48 in one file, at the site root where browsers and
    # crawlers probe for it even when <link rel=icon> says otherwise.
    with tempfile.TemporaryDirectory() as tmp:
        big = pathlib.Path(tmp) / "ico.png"
        render(fav, big, 64)
        base = Image.open(big).convert("RGBA")
        base.save(ROOT / "favicon.ico",
                  sizes=[(16, 16), (32, 32), (48, 48)])

    # A raster of the full mark, for anything that cannot take SVG. 256 px is
    # twice the largest size it is ever drawn at on the site.
    render(logo, IMG / "logo.png", 256)
    squeeze(IMG / "logo.png")
    # /logo.png was the og:image and the favicon for the site's whole life, so
    # the URL is in link-preview caches and in anything that ever hotlinked it.
    # Keep it live — as the 4 KB raster, not the 790 KB original.
    (ROOT / "logo.png").write_bytes((IMG / "logo.png").read_bytes())

    for p in sorted(IMG.iterdir()) + [ROOT / "favicon.ico"]:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
