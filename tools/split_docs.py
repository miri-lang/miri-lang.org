#!/usr/bin/env python3
"""Generate one Jekyll collection doc per <h2> topic from a guide's aggregate page.

The two aggregate pages (docs/getting-started/index.html, docs/gpu/index.html) stay
the single source of truth for guide content — this script never reads or writes
them for content, only for their `sidebar` front matter (id/title/group/order) and
their <h2 id="...">...</h2> sections. Re-run after any edit to either aggregate
page's <h2> sections or its `sidebar` list; do not hand-edit files under
_docs_getting_started/ or _docs_gpu/, they are overwritten wholesale on each run.

Usage: python3 tools/split_docs.py
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent

GUIDES = [
    {
        "slug": "getting-started",
        "title": "Getting Started",
        "source": ROOT / "docs/getting-started/index.html",
        "out_dir": ROOT / "_docs_getting_started",
        # Boundary pager targets — mirrors the aggregate page's own pager.
        "first_prev": {"title": "Documentation", "url": "/docs/"},
        "last_next": {"title": "GPU Programming", "url": "/docs/gpu/"},
    },
    {
        "slug": "gpu",
        "title": "GPU Programming",
        "source": ROOT / "docs/gpu/index.html",
        "out_dir": ROOT / "_docs_gpu",
        "first_prev": {"title": "Getting Started", "url": "/docs/getting-started/"},
        "last_next": {"title": "GPU Playground", "url": "/gpu-demos/"},
    },
]

FRONT_MATTER_RE = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.DOTALL)
H2_RE = re.compile(r'<h2 id="([a-zA-Z0-9_-]+)"[^>]*>(.*?)</h2>', re.DOTALL)
H3_ID_RE = re.compile(r'<h3 id="([a-zA-Z0-9_-]+)"')
HASH_HREF_RE = re.compile(r'href="#([a-zA-Z0-9_-]+)"')
TAG_RE = re.compile(r"<[^>]+>")
# `<p(?=[\s>])` (not `<p[^>]*>`) so this doesn't also match `<pre …>` — "pre"
# starts with "p" too.
P_RE = re.compile(r"<p(?=[\s>])[^>]*>(.*?)</p>", re.DOTALL)
WS_RE = re.compile(r"\s+")


def strip_tags(fragment):
    """Strip real HTML tags but keep entities (&lt; &amp; …) escaped — the
    result is embedded raw into HTML text nodes, attribute values and RCDATA
    (<title>) alike, and the escaped form is the only spelling safe in all
    three (a literal "<" is only safe in the latter two)."""
    text = TAG_RE.sub("", fragment)
    return WS_RE.sub(" ", text).strip()


def make_description(text):
    text = text.strip()
    m = re.match(r"^(.{40,200}?[.!?])(\s|$)", text)
    if m and len(m.group(1)) <= 165:
        return m.group(1)
    if len(text) <= 165:
        return text
    truncated = text[:157].rsplit(" ", 1)[0]
    return truncated + "…"


def first_paragraph_text(section_body):
    m = P_RE.search(section_body)
    return strip_tags(m.group(1)) if m else ""


def parse_source(path):
    text = path.read_text()
    m = FRONT_MATTER_RE.match(text)
    if not m:
        sys.exit(f"{path}: could not parse front matter")
    front_matter = yaml.safe_load(m.group(1))
    body = m.group(2)
    return front_matter, body


def build_sections(body):
    matches = list(H2_RE.finditer(body))
    sections = {}
    order = []
    for i, m in enumerate(matches):
        topic_id = m.group(1)
        title_html = m.group(2).strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        raw = body[start:end].rstrip()
        sections[topic_id] = {"title_html": title_html, "raw": raw, "h2_match": m}
        order.append(topic_id)
    return sections, order


def build_id_home_map(sections):
    home = {}
    for topic_id, sec in sections.items():
        home[topic_id] = topic_id
        for sub in H3_ID_RE.findall(sec["raw"]):
            home[sub] = topic_id
    return home


def rewrite_hashrefs(raw, current_topic, guide_slug, id_home):
    def repl(m):
        target_id = m.group(1)
        home = id_home.get(target_id)
        if home is None or home == current_topic:
            return m.group(0)  # unknown, or resolves on this same page — leave local
        base = f"{{{{ '/docs/{guide_slug}/{home}/' | relative_url }}}}"
        if target_id == home:
            return f'href="{base}"'
        return f'href="{base}#{target_id}"'

    return HASH_HREF_RE.sub(repl, raw)


def strip_leading_h2(raw, title_html):
    body_after = raw[raw.index("</h2>") + len("</h2>"):]
    return f"<h1>{title_html}</h1>{body_after}"


def dump_front_matter(fm):
    return yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False, width=1000)


def generate_guide(guide, other_guides_by_slug):
    front_matter, body = parse_source(guide["source"])
    sidebar = front_matter["sidebar"]
    sections, order_from_body = build_sections(body)

    sidebar_ids = [item["id"] for item in sidebar]
    if sidebar_ids != order_from_body:
        sys.exit(
            f"{guide['source']}: sidebar order {sidebar_ids} does not match "
            f"<h2> order {order_from_body} — split_docs.py assumes 1:1, in-order match"
        )

    id_home = build_id_home_map(sections)

    guide["out_dir"].mkdir(exist_ok=True)
    for existing in guide["out_dir"].glob("*.html"):
        existing.unlink()

    n = len(sidebar)
    generated = []
    for i, item in enumerate(sidebar):
        topic_id = item["id"]
        nav_title = strip_tags(item["title"])
        plain_title = nav_title
        if topic_id == "whats-next":
            # Both guides end on a "What's Next" section — disambiguate the
            # <title> tag, titles must be unique across the whole site. The
            # sidebar/breadcrumb keep the shorter nav_title.
            plain_title = f"{plain_title}: {guide['title']}"
        sec = sections[topic_id]

        raw = rewrite_hashrefs(sec["raw"], topic_id, guide["slug"], id_home)
        page_body = strip_leading_h2(raw, sec["title_html"])

        description = make_description(first_paragraph_text(page_body))

        if i == 0:
            pager_prev = guide["first_prev"]
        else:
            prev_item = sidebar[i - 1]
            pager_prev = {"title": strip_tags(prev_item["title"]), "url": f"/docs/{guide['slug']}/{prev_item['id']}/"}

        if i == n - 1:
            pager_next = guide["last_next"]
        else:
            next_item = sidebar[i + 1]
            pager_next = {"title": strip_tags(next_item["title"]), "url": f"/docs/{guide['slug']}/{next_item['id']}/"}

        fm = {
            "layout": "docs-topic",
            "guide": guide["slug"],
            "guide_title": guide["title"],
            "topic_id": topic_id,
            "order": i + 1,
            "nav_title": nav_title,
            "title": f"{plain_title} — Miri Programming Language",
            "description": description,
            "og_image": "/assets/og/docs.png",
            "permalink": f"/docs/{guide['slug']}/{topic_id}/",
            "pager_prev": pager_prev,
            "pager_next": pager_next,
        }
        if item.get("group"):
            fm["group"] = strip_tags(item["group"])

        out_text = "---\n" + dump_front_matter(fm) + "---\n\n" + page_body.strip() + "\n"
        out_path = guide["out_dir"] / f"{i + 1:02d}-{topic_id}.html"
        out_path.write_text(out_text)
        generated.append(topic_id)

    print(f"{guide['slug']}: generated {len(generated)} topic pages in {guide['out_dir']}")


def main():
    for guide in GUIDES:
        generate_guide(guide, GUIDES)


if __name__ == "__main__":
    main()
