#!/usr/bin/env python3
"""Vendor everything the "Miri for agents" guide shows from the compiler repo.

Run from anywhere:  python3 tools/gen_agent_docs.py

The guide's prose lives in docs/agents/index.html, but nothing it quotes from
the compiler is typed by hand. This script writes:

- `_data/agent_sources.json` — each skill pack (`skills/<name>/SKILL.md`) and
  each example program (`examples/agents/*.mi`), as exact strings. The guide
  renders the loop, the traps and the repair list straight out of the packs.
  They are data rather than includes because Jekyll runs an include through
  Liquid, and a `{{` in a pack or a program would change what the page shows.
- `_data/agent_codes.json` — the output of `miri explain --list --format json`,
  the source of every count and of the code column in the repair table.
- `_data/diagnostics_schema.json` — `docs/diagnostics-schema.json`, the source
  of the field tables.
- `_data/agent_runs.json` — what each command in `examples/agents/runs.toml`
  printed, run by the compiler built from the sibling repo's working tree.

The compiler repo's `agent_docs` tests compare all of it with a fresh render,
so a pack, example or output changed there without re-running this script
fails that repo's suite. Never hand-edit the files above.

Expects the Miri repo checked out as a sibling directory named `miri`.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import tomllib

SITE = pathlib.Path(__file__).resolve().parent.parent
REPO = SITE.parent / "miri"
COMPILER = REPO / "target" / "release" / "miri"
EXAMPLES = REPO / "examples" / "agents"
DATA = SITE / "_data"


class GenerationError(RuntimeError):
    """A condition that would otherwise publish stale or wrong content."""


def build_compiler() -> None:
    """Rebuild the release compiler, so recorded output matches the working tree."""
    if shutil.which("cargo") is None:
        raise GenerationError("cargo not found; the recorded output needs the compiler")
    print("building the release compiler ...")
    done = subprocess.run(["cargo", "build", "--release"], cwd=REPO)
    if done.returncode != 0:
        raise GenerationError("cargo build --release failed")


def vendor_sources() -> None:
    packs = sorted(p for p in (REPO / "skills").iterdir() if (p / "SKILL.md").is_file())
    sources = {
        "skills": {p.name: (p / "SKILL.md").read_text() for p in packs},
        "examples": {e.name: e.read_text() for e in sorted(EXAMPLES.glob("*.mi"))},
    }
    write_json(DATA / "agent_sources.json", sources)
    print(f"skills: {', '.join(sources['skills'])}; examples: {', '.join(sources['examples'])}")


def write_json(path: pathlib.Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def vendor_registry() -> None:
    done = subprocess.run(
        [str(COMPILER), "explain", "--list", "--format", "json"],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        raise GenerationError(f"miri explain --list failed:\n{done.stderr}")
    write_json(DATA / "agent_codes.json", json.loads(done.stdout))
    schema = json.loads((REPO / "docs" / "diagnostics-schema.json").read_text())
    write_json(DATA / "diagnostics_schema.json", schema)


def normalised(text: str, directory: pathlib.Path) -> str:
    """Drop the session directory from printed paths, as the gate does.

    The canonical spelling (`/private/var/...` on macOS) goes first: it
    contains the other one, so removing the shorter spelling first would leave
    `/private` behind."""
    for prefix in (str(directory.resolve()), str(directory)):
        text = text.replace(prefix + "/", "")
    return text


def replay(session: dict) -> list[dict]:
    env = dict(os.environ)
    env.pop("NO_COLOR", None)
    with tempfile.TemporaryDirectory() as raw:
        directory = pathlib.Path(raw)
        for name in session["files"]:
            shutil.copyfile(EXAMPLES / name, directory / name)
        steps = []
        for step in session["step"]:
            done = subprocess.run(
                [str(COMPILER), *step["args"]],
                cwd=directory, capture_output=True, text=True, env=env,
            )
            if done.returncode != step["exit"]:
                raise GenerationError(
                    f"session {session['id']}: miri {' '.join(step['args'])} exited "
                    f"{done.returncode}, runs.toml expects {step['exit']}\n{done.stderr}"
                )
            steps.append({
                "args": step["args"],
                "exit": done.returncode,
                "stdout": normalised(done.stdout, directory),
                "stderr": normalised(done.stderr, directory),
            })
        return steps


def record_runs() -> None:
    manifest = tomllib.loads((EXAMPLES / "runs.toml").read_text())
    runs = {session["id"]: replay(session) for session in manifest["session"]}
    write_json(DATA / "agent_runs.json", runs)
    print(f"runs: {len(runs)} sessions recorded")


def main() -> int:
    if not REPO.is_dir():
        print(f"error: the Miri repo is not checked out at {REPO}", file=sys.stderr)
        return 1
    try:
        build_compiler()
        vendor_sources()
        vendor_registry()
        record_runs()
    except GenerationError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
