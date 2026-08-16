# miri-lang.org

The website for **Miri: GPU-first programming language** — homepage, documentation, and eight live GPU demos that are real Miri programs compiled to WebGPU.

Jekyll, no plugins beyond the defaults, deployed to GitHub Pages from `main`. Live at [miri-lang.org](https://miri-lang.org).

## Running it locally

```bash
bundle install
bundle exec jekyll serve      # http://localhost:4000, with live reload
bundle exec jekyll build      # one-shot build into _site/
```

The GPU demos need a browser with WebGPU enabled. They degrade to a poster image and a message where it is unavailable, so the rest of the site works without it.

## Layout

```text
index.html            Homepage — hero, examples switcher, feature cards, demo previews
docs/                 Documentation hub, the language guide, the GPU guide
gpu-demos.html        The playground — all eight demos on one page
_layouts/             default (head, nav, footer, JSON-LD), docs, legal
_includes/            nav, footer, schema.html (the entity graph), email/address helpers
_data/features.yml    Homepage feature cards
assets/
  css/style.css       The whole design system — one file, no preprocessor
  js/miri-demos.js    Loads and drives every compiled demo bundle
  demos/              Compiled Miri → WebGPU bundles + poster images
  fonts/              Self-hosted woff2 (see below)
tools/                Build-side scripts (font fetch, demo bundle generation)
notes/                Working notes — excluded from the build and from git
impressum.html
datenschutz.html      German legal pages, gated on the address in _config.yml
```

## Things that will bite you if you don't know them

**The demos are generated, not hand-written.** `tools/gen_displayed_demos.py` pulls each demo's source verbatim from `examples/gpu/web/<name>.mi` in the [compiler repo](https://github.com/miri-lang/miri) into `assets/demos/<name>.mi` and into the code block on the page; `tools/gen_demo_bundles.py` then compiles exactly those bytes with `miri build --target web-gpu` and vendors the emitted manifest to `assets/demos/bundles/<name>.json` plus the runtime driver to `assets/js/miri-gpu.js`. The site runs the compiler's own WGSL output, never a hand-written renderer — so edit the demo in the compiler repo and regenerate, never the vendored artifacts here.

**Fonts are self-hosted on purpose.** Space Grotesk and JetBrains Mono are served from this origin, not from `fonts.googleapis.com`, because that request would transmit every visitor's IP to a third party before any consent exists — and `/datenschutz/` states that this site makes no third-party requests. Regenerate with `tools/fetch-fonts.rb`. Keep it that way.

**The positioning string is one string.** `entity.positioning` in `_config.yml` is `Miri: GPU-first programming language`, and it must stay character-for-character identical to the `miri-lang/miri` repo About line and that repo's README H1. The one-sentence description lives once, in `_config.yml` `description`, and is inherited by the homepage meta description and by the `WebSite` JSON-LD node — don't add a second copy to a page's front matter.

**Structured data comes from `_includes/schema.html`.** One `@graph` with stable `@id`s, emitted on every page, driven entirely by the `entity:` block in `_config.yml`. `_layouts/docs.html` adds a `BreadcrumbList` from each docs page's `breadcrumb` front matter. After touching either, re-check with the [schema.org validator](https://validator.schema.org/) — the target is zero errors *and* zero warnings.

**The legal pages are gated.** `/impressum/` and `/datenschutz/` stay `noindex`, out of the sitemap, and unlinked from the footer until `legal.street` and `legal.city` are filled in `_config.yml`. The same condition appears in `_layouts/default.html`, `_includes/footer.html` and `sitemap.xml` — change one, change all three.

## SEO backlog

`notes/seo-aeo-audit.md` holds the audit and the task list it came from, with acceptance criteria per task and a record of which ones were met, deferred, or deliberately rejected. It is not published — `notes/` is in both `.gitignore` and the Jekyll `exclude` list.

## License

Site content and code: [Apache-2.0](https://github.com/miri-lang/miri/blob/main/LICENSE), same as the compiler.
