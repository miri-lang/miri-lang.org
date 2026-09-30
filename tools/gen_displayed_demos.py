#!/usr/bin/env python3
"""Regenerate the displayed GPU-demo source from the Miri repo, verbatim.

Each web demo's own page under `_gpu_demos/` shows a contiguous byte-range of its repo
source `examples/gpu/web/<name>.mi`: from the first `use` line through the line
before the `// Native smoke` tail. The stripped parts — the license/doc header
and the host-side smoke test — emit no WGSL, so the shown slice compiles to
byte-identical WebGPU kernels. The Miri repo's `wgsl_identity` gate enforces
both properties (displayed == verbatim repo slice, and same WGSL), so this
script and that gate are two ends of the same "no drift" guarantee.

Run from anywhere:  python3 tools/gen_displayed_demos.py

It writes `assets/demos/<name>.mi` (the copyable program) and rewrites the inline
`<pre class="lang-miri">` block of the demo page under `_gpu_demos/` whose code
header names `<name>.mi`. Expects the Miri repo checked out as a sibling
directory named `miri`.
"""
import html
import pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent
REPO = SITE.parent / "miri"
DEMOS = [
    "mandelbrot", "game_of_life", "particles", "fluid",
    "raymarch", "neural", "blackhole", "wormhole",
]


def displayed_region(full: str) -> str:
    """First `use ` line through the line before the `// Native smoke` tail."""
    lines = full.splitlines(keepends=True)
    start = next(i for i, ln in enumerate(lines) if ln.startswith("use "))
    end = next(i for i, ln in enumerate(lines)
               if ln.lstrip().startswith("// Native smoke"))
    return "".join(lines[start:end]).rstrip("\n") + "\n"


def anchor(name: str) -> str:
    return f'<span class="code-filename">{name}.mi</span>'


def regen_pre(page: str, name: str, region: str) -> str:
    esc = html.escape(region, quote=False).rstrip("\n")
    idx = page.index(anchor(name))
    body_start = page.index('<pre class="lang-miri">\n', idx) \
        + len('<pre class="lang-miri">\n')
    pre_close = page.index('</pre>', body_start)
    return page[:body_start] + esc + "\n" + page[pre_close:]


def demo_page(name: str) -> pathlib.Path:
    """The one page under `_gpu_demos/` whose code header names `name.mi`."""
    pages = [p for p in sorted((SITE / "_gpu_demos").glob("*.html"))
             if anchor(name) in p.read_text()]
    if len(pages) != 1:
        raise SystemExit(
            f"{name}: expected one _gpu_demos/ page showing {name}.mi, "
            f"found {len(pages)}")
    return pages[0]


def main() -> None:
    demos_dir = SITE / "assets" / "demos"
    demos_dir.mkdir(parents=True, exist_ok=True)
    for name in DEMOS:
        full = (REPO / "examples" / "gpu" / "web" / f"{name}.mi").read_text()
        region = displayed_region(full)
        (demos_dir / f"{name}.mi").write_text(region)
        page_path = demo_page(name)
        page_path.write_text(regen_pre(page_path.read_text(), name, region))
        print(f"{name}: {len(region)} bytes -> {page_path.relative_to(SITE)}")
    print("regenerated _gpu_demos/*.html + assets/demos/*.mi")


if __name__ == "__main__":
    main()
