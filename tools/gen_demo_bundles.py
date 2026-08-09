#!/usr/bin/env python3
"""Compile each published GPU demo and vendor the resulting WebGPU artifacts.

Run from anywhere:  python3 tools/gen_demo_bundles.py

Each demo is compiled from `assets/demos/<name>.mi` — the exact bytes shown on
`gpu-demos.html` and copied by readers — with `miri build --target web-gpu`. The
emitted manifest, which carries the WGSL the compiler produced, is vendored to
`assets/demos/bundles/<name>.json`, and the shared runtime driver to
`assets/js/miri-gpu.js`. The site then runs the compiler's own output rather
than anything hand-written.

Artifacts are committed because GitHub Pages cannot run the Miri compiler at
publish time. That makes a stale artifact the obvious failure mode, so this
script refuses to produce one: it rebuilds the compiler first, checks the
displayed sources are current, and records the compiler commit it used in
`assets/demos/bundles/BUILD.json`.

Expects the Miri repo checked out as a sibling directory named `miri`.
"""
import gzip
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

from gen_displayed_demos import DEMOS, displayed_region

SITE = pathlib.Path(__file__).resolve().parent.parent
REPO = SITE.parent / "miri"
BUNDLES = SITE / "assets" / "demos" / "bundles"
RUNTIME_JS_SRC = REPO / "assets" / "web" / "miri-gpu.js"
RUNTIME_JS_DST = SITE / "assets" / "js" / "miri-gpu.js"
COMPILER = REPO / "target" / "release" / "miri"


class GenerationError(RuntimeError):
    """A condition that would otherwise publish stale or wrong artifacts."""


def run(cmd: list[str], env: dict | None = None) -> str:
    done = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if done.returncode != 0:
        raise GenerationError(
            f"command failed: {' '.join(cmd)}\n{done.stdout}\n{done.stderr}"
        )
    return done.stdout


def compiler_env() -> dict:
    """Environment for invoking the compiler from outside the Miri repo.

    A `miri` built into `target/` is a development binary: it looks for the
    standard library at `src/stdlib` relative to the working directory, which
    from this repo resolves to nothing and makes every `system.*` import fail
    with a wall of type errors. `MIRI_STDLIB_PATH` points it at the real
    directory without depending on where the script was run from.
    """
    env = dict(os.environ)
    env["MIRI_STDLIB_PATH"] = str(REPO / "src" / "stdlib")
    return env


def build_compiler() -> None:
    """Rebuild the release compiler the bundles are emitted by.

    The runtime driver is baked into the compiler binary at compile time, so a
    stale binary silently emits bundles carrying an old driver. Building here
    means the artifacts always match the sibling repo's working tree.
    """
    if shutil.which("cargo") is None:
        raise GenerationError(
            "cargo not found. Bundles are compiled artifacts and cannot be "
            "regenerated without the Rust toolchain."
        )
    print("building the release compiler ...")
    run(["cargo", "build", "--release", "--manifest-path", str(REPO / "Cargo.toml")])
    if not COMPILER.is_file():
        raise GenerationError(f"expected the compiler at {COMPILER} after building")


def check_displayed_sources_current() -> None:
    """The bundles are compiled from what the page shows, so it must be current."""
    stale = []
    for name in DEMOS:
        shown = SITE / "assets" / "demos" / f"{name}.mi"
        expected = displayed_region((REPO / "examples" / "gpu" / "web" / f"{name}.mi").read_text())
        if not shown.is_file() or shown.read_text() != expected:
            stale.append(name)
    if stale:
        raise GenerationError(
            "displayed source is stale for: " + ", ".join(stale) + "\n"
            "Run tools/gen_displayed_demos.py first — bundles are compiled from "
            "the displayed bytes, so publishing now would ship kernels that do "
            "not match the code on the page."
        )


def compile_demo(name: str, workdir: pathlib.Path) -> bytes:
    """Compile one demo and return its manifest bytes.

    The build also emits a native host binary and an object file alongside the
    manifest. Compiling into a temporary directory keeps those out of the site
    repo entirely rather than relying on a copy step to skip them.
    """
    out = workdir / name
    run([str(COMPILER), "build", "--target", "web-gpu", "-o", str(out),
         str(SITE / "assets" / "demos" / f"{name}.mi")], env=compiler_env())
    manifest = out / f"{name}.json"
    if not manifest.is_file():
        emitted = ", ".join(sorted(p.name for p in out.iterdir())) if out.is_dir() else "nothing"
        raise GenerationError(f"{name}: no manifest emitted (bundle contains: {emitted})")
    data = manifest.read_bytes()
    parsed = json.loads(data)
    kernels = list(parsed.get("seed") or []) + list(parsed.get("framePasses") or [])
    if not kernels:
        raise GenerationError(f"{name}: manifest declares no kernels")
    if any(not k.get("wgsl") for k in kernels):
        raise GenerationError(f"{name}: a kernel carries no WGSL")
    return data


def compiler_revision() -> dict:
    try:
        commit = run(["git", "-C", str(REPO), "rev-parse", "HEAD"]).strip()
        dirty = bool(run(["git", "-C", str(REPO), "status", "--porcelain"]).strip())
    except GenerationError:
        return {"commit": None, "dirty": None}
    return {"commit": commit, "dirty": dirty}


def main() -> int:
    if not REPO.is_dir():
        print(f"error: Miri repo not found at {REPO}", file=sys.stderr)
        return 1
    try:
        build_compiler()
        check_displayed_sources_current()

        BUNDLES.mkdir(parents=True, exist_ok=True)
        RUNTIME_JS_DST.parent.mkdir(parents=True, exist_ok=True)

        sizes = {}
        with tempfile.TemporaryDirectory() as tmp:
            workdir = pathlib.Path(tmp)
            for name in DEMOS:
                data = compile_demo(name, workdir)
                (BUNDLES / f"{name}.json").write_bytes(data)
                sizes[name] = {"raw": len(data), "gzip": len(gzip.compress(data, 9))}
                print(f"  {name:<14} {len(data) / 1000:7.1f} kB raw"
                      f"   {sizes[name]['gzip'] / 1000:6.1f} kB gzipped")

        shutil.copyfile(RUNTIME_JS_SRC, RUNTIME_JS_DST)
        runtime_bytes = RUNTIME_JS_DST.read_bytes()

        stray = sorted(p.name for p in BUNDLES.iterdir()
                       if p.suffix != ".json" or p.name.endswith(".mi"))
        if stray:
            raise GenerationError(
                "non-manifest files in the bundle directory: " + ", ".join(stray)
            )

        (BUNDLES / "BUILD.json").write_text(json.dumps({
            "generatedBy": "tools/gen_demo_bundles.py",
            "compiledFrom": "assets/demos/<name>.mi",
            "compiler": compiler_revision(),
            "runtimeJsBytes": len(runtime_bytes),
            "demos": sizes,
        }, indent=2) + "\n")

        total_raw = sum(s["raw"] for s in sizes.values())
        total_gz = sum(s["gzip"] for s in sizes.values())
        print(f"\n{len(sizes)} manifests: {total_raw / 1000:.0f} kB raw, "
              f"{total_gz / 1000:.0f} kB gzipped")
        print(f"runtime driver: {len(runtime_bytes) / 1000:.1f} kB "
              f"({len(gzip.compress(runtime_bytes, 9)) / 1000:.1f} kB gzipped)")
        print(f"wrote {BUNDLES.relative_to(SITE)}/*.json + "
              f"{RUNTIME_JS_DST.relative_to(SITE)}")
    except GenerationError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
