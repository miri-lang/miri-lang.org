#!/usr/bin/env python3
"""Render the Open Graph / Twitter card images (1200x630) for the site.

Link previews were pointing at `logo.png`: a 700x700 square, so every share of
this site rendered as a letterboxed or cropped postage stamp regardless of the
page. These cards are built from the site's own design system — the same
palette, the same self-hosted Space Grotesk / JetBrains Mono, the same pixel
grid — by rendering a small HTML template in headless Chrome at exactly
1200x630, which is why they cannot drift away from how the site actually looks.

Emits:
    assets/og/default.png     every page that does not override it
    assets/og/docs.png        /docs/ and the guides
    assets/og/gpu-demos.jpg   /gpu-demos/, built over the real demo posters
    assets/og/gpu-demos-<slug>.jpg   each /gpu-demos/<slug>/ page (P1-2), one poster each

A page opts into a card other than the default with `og_image:` in its front
matter (see _layouts/default.html).

Usage:  python3 tools/gen_og_images.py
"""

import functools
import http.server
import pathlib
import socketserver
import subprocess
import threading

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og"

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

W, H = 1200, 630

# Kept in sync with :root in assets/css/style.css by hand — this file renders
# outside Jekyll, so it cannot read the stylesheet's custom properties.
SHELL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Space Grotesk'; font-style: normal; font-weight: 400 700;
    src: url('/assets/fonts/space-grotesk-400-700-latin.woff2') format('woff2');
  }
  @font-face {
    font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 600;
    src: url('/assets/fonts/jetbrains-mono-400-600-latin.woff2') format('woff2');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: __W__px; height: __H__px; overflow: hidden; }
  body {
    background: #04070f;
    color: #e9eefb;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { position: relative; width: __W__px; height: __H__px; overflow: hidden; }
  /* the site's fixed grid backdrop */
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(110, 142, 255, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(110, 142, 255, 0.05) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse 110% 90% at 20% 0%, black 20%, transparent 80%);
  }
  .glow {
    position: absolute; width: 900px; height: 900px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 216, 61, 0.14), transparent 62%);
    top: -420px; left: -180px;
  }
  .inner { position: relative; height: 100%; padding: 66px 72px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 64px; height: 64px; border-radius: 15px; }
  .brand span { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .kicker {
    margin-bottom: 14px;
    font-family: 'JetBrains Mono', monospace; font-size: 19px; letter-spacing: 0.14em;
    color: #ffd83d; text-transform: uppercase;
  }
  h1 {
    font-size: 68px; font-weight: 700; letter-spacing: -0.035em; line-height: 1.04;
    text-wrap: balance;
  }
  .hl { color: #ffd83d; }
  p { margin-top: 18px; font-size: 27px; line-height: 1.45; color: #93a3c9; max-width: 940px; }
  p code { font-family: 'JetBrains Mono', monospace; font-size: 0.88em; color: #ffd83d; }
  .spacer { flex: 1; }
  .foot {
    display: flex; align-items: center; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace; font-size: 21px; color: #5b6b95;
  }
  .foot b { color: #93a3c9; font-weight: 400; }
  __EXTRA__
</style></head>
<body>__BODY__</body></html>
"""


def card(kicker, headline, sub, foot_right="Apache-2.0 · beta", extra="", body_top=""):
    kicker_html = f'<div class="kicker">{kicker}</div>' if kicker else ""
    body = f"""<div class="card">
  <div class="grid"></div><div class="glow"></div>{body_top}
  <div class="inner">
    <div class="brand"><img src="/assets/img/logo.svg" alt=""><span>Miri</span></div>
    <div class="spacer"></div>
    {kicker_html}
    <h1>{headline}</h1>
    <p>{sub}</p>
    <div class="spacer"></div>
    <div class="foot"><b>miri-lang.org</b><span>{foot_right}</span></div>
  </div>
</div>"""
    return (SHELL.replace("__W__", str(W)).replace("__H__", str(H))
            .replace("__EXTRA__", extra).replace("__BODY__", body))


CARDS = {
    # The default card carries the positioning string verbatim — it is the same
    # string as the <h1>, the <title> and entity.positioning in _config.yml.
    "default.png": card(
        kicker="",
        headline='Miri: <span class="hl">GPU-first</span><br>programming language',
        sub="Statically typed, natively compiled. Mark data <code>gpu</code>, launch with "
            "<code>forall</code> — no shader files, no FFI, no CUDA toolchain.",
    ),
    "docs.png": card(
        kicker="documentation",
        headline='The <span class="hl">Miri</span> guides',
        sub="Install the compiler, tour the language, then write GPU kernels: residency, "
            "<code>forall</code>, shared memory, atomics and interactive frame loops.",
    ),
    "faq.png": card(
        kicker="faq",
        headline='Questions about <span class="hl">Miri</span>',
        sub="What it is, who it is for, whether it is production ready, which GPUs it "
            "runs on, and what does not work yet — answered short and straight.",
    ),
    # The demos card sits on the real poster frames — those are the compiler's
    # own WGSL output, which is the whole claim the page makes.
    "gpu-demos.jpg": card(
        kicker="gpu playground",
        headline='Eight demos, <span class="hl">live</span> on your GPU',
        sub="Every tile is a real Miri program compiled to WebGPU and running in the "
            "browser — black hole, wormhole, fluid, particles, a neural net.",
        foot_right="webgpu · no install",
        extra="""
  .posters { position: absolute; inset: 0; display: grid;
             grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(2, 1fr); }
  .posters img { width: 100%; height: 100%; object-fit: cover; opacity: 0.92; }
  .veil { position: absolute; inset: 0;
          background: linear-gradient(100deg, #04070f 26%, rgba(4, 7, 15, 0.93) 50%,
                                      rgba(4, 7, 15, 0.34) 100%); }
""",
        body_top="""<div class="posters">
    <img src="/assets/demos/posters/fluid.jpg"><img src="/assets/demos/posters/neural.jpg">
    <img src="/assets/demos/posters/blackhole.jpg"><img src="/assets/demos/posters/particles.jpg">
    <img src="/assets/demos/posters/mandelbrot.jpg"><img src="/assets/demos/posters/game_of_life.jpg">
    <img src="/assets/demos/posters/wormhole.jpg"><img src="/assets/demos/posters/raymarch.jpg">
  </div><div class="veil"></div>""",
    ),
}


def demo_card(poster, kicker, headline, sub, foot_right):
    """A per-demo card (P1-2): the demo's own poster, full-bleed, under the
    same veil gradient as the gallery collage — so a share of one demo shows
    that demo, not a generic card or the eight-tile collage."""
    return card(
        kicker=kicker,
        headline=headline,
        sub=sub,
        foot_right=foot_right,
        extra="""
  .poster1 { position: absolute; inset: 0; }
  .poster1 img { width: 100%; height: 100%; object-fit: cover; opacity: 0.95; }
  .veil { position: absolute; inset: 0;
          background: linear-gradient(100deg, #04070f 30%, rgba(4, 7, 15, 0.94) 55%,
                                      rgba(4, 7, 15, 0.4) 100%); }
""",
        body_top=f'<div class="poster1"><img src="/assets/demos/posters/{poster}"></div><div class="veil"></div>',
    )


DEMO_CARDS = [
    dict(slug="mandelbrot", poster="mandelbrot.jpg",
         headline='Mandelbrot, <span class="hl">live</span> on the GPU',
         sub="Two passes a frame, ping-ponged view state, zooming forever — a real Miri "
             "program compiled straight to WebGPU.",
         foot_right="fragment kernel · ∞ zoom"),
    dict(slug="life", poster="game_of_life.jpg",
         headline="Conway's Life, <span class=\"hl\">on the device</span>",
         sub="One gpu frame chains five passes over ping-ponged grids — a real Miri "
             "program compiled straight to WebGPU.",
         foot_right="cellular automaton"),
    dict(slug="particles", poster="particles.jpg",
         headline='147,456 particles, <span class="hl">one kernel</span>',
         sub="Curl noise and GPU atomics, all state resident on the device — a real "
             "Miri program compiled straight to WebGPU.",
         foot_right="147,456 particles"),
    dict(slug="fluid", poster="fluid.jpg",
         headline='A fluid solver, <span class="hl">30 passes</span> a frame',
         sub="Stam-style stable fluids with an 18-pass Jacobi pressure solve — a real "
             "Miri program compiled straight to WebGPU.",
         foot_right="30 passes · pressure solve"),
    dict(slug="raymarch", poster="raymarch.jpg",
         headline='Ray marching, <span class="hl">no triangles</span>',
         sub="Signed-distance fields, soft shadows, a Fresnel rim — a real Miri "
             "program compiled straight to WebGPU.",
         foot_right="SDF · soft shadows"),
    dict(slug="neural", poster="neural.jpg",
         headline='A neural net, <span class="hl">training live</span>',
         sub="205 parameters, one training step per frame, no CPU round trip — a real "
             "Miri program compiled straight to WebGPU.",
         foot_right="2-12-12-1 MLP · live gradient descent"),
    dict(slug="blackhole", poster="blackhole.jpg",
         headline='A black hole, <span class="hl">lensing light</span>',
         sub="Every pixel integrates a photon's geodesic through curved spacetime — a "
             "real Miri program compiled straight to WebGPU.",
         foot_right="photon geodesics · accretion disk"),
    dict(slug="wormhole", poster="wormhole.jpg",
         headline='A wormhole, <span class="hl">two universes</span>',
         sub="Rays traced through a Morris–Thorne throat into a second sky — a real "
             "Miri program compiled straight to WebGPU.",
         foot_right="Morris–Thorne throat"),
]

for d in DEMO_CARDS:
    CARDS[f"gpu-demos-{d['slug']}.jpg"] = demo_card(
        poster=d["poster"], kicker="gpu demo", headline=d["headline"],
        sub=d["sub"], foot_right=d["foot_right"],
    )


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def serve():
    """Serve the repo over HTTP: the templates pull the real fonts and posters,
    and Chrome will not load either across file:// origins."""
    handler = functools.partial(_Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)  # port 0: never collide
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    port = httpd.server_address[1]
    try:
        for name, html in CARDS.items():
            tmp = ROOT / f".og-{name}.html"
            tmp.write_text(html)
            shot = OUT / (name + ".raw.png")
            try:
                subprocess.run(
                    [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                     "--force-device-scale-factor=1",
                     f"--window-size={W},{H}", "--virtual-time-budget=6000",
                     f"--screenshot={shot}",
                     f"http://127.0.0.1:{port}/{tmp.name}"],
                    check=True, capture_output=True, timeout=120)
            finally:
                tmp.unlink()
            im = Image.open(shot).convert("RGB")
            shot.unlink()
            assert im.size == (W, H), f"{name} is {im.size}, expected {(W, H)}"
            if name.endswith(".jpg"):
                # Photographic: the poster collage is 200 KB+ as a quantised PNG
                # and half that as a JPEG with no visible loss at card size.
                im.save(OUT / name, "JPEG", quality=86, optimize=True,
                        progressive=False, subsampling=0)
            else:
                # Flat vector art: a 96-colour palette is lossless in practice.
                im.quantize(colors=96, method=Image.Quantize.MEDIANCUT).save(
                    OUT / name, optimize=True)
            print(f"{(OUT / name).relative_to(ROOT)}  {(OUT / name).stat().st_size / 1024:.0f} KB")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
