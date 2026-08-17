// Mounts the compiled Miri demos on the GPU playground page.
//
// Every demo on the page is the output of `miri build --target web-gpu`: a
// manifest of WGSL kernels under assets/demos/bundles/, driven by the compiler's
// own runtime, miri-gpu.js. There is no second implementation and no fallback
// renderer — a browser without WebGPU is shown a still frame and told so,
// because an animation that did not come out of the compiler would misrepresent
// what the page is demonstrating.
//
// Paths resolve against this module's own URL, so the site's base URL is
// followed without the page having to inject it.

const BUNDLES = new URL("../demos/bundles/", import.meta.url);
const POSTERS = new URL("../demos/posters/", import.meta.url);
const RUNTIME = new URL("./miri-gpu.js", import.meta.url);

// The page names a demo by its slug; the compiler names it after its source
// file. They agree everywhere except Game of Life.
const COMPILED_NAME = { life: "game_of_life" };

// Descriptive alt text for each demo's still-frame poster — shown in the
// no-WebGPU fallback, and the same posters Google Images can index. Empty alt
// text here would ship on every page that mounts a demo (the playground, its
// per-demo URLs, and the homepage's preview grid), so it lives once, by slug.
const POSTER_ALT = {
    mandelbrot: "A zoomed Mandelbrot fractal rendered on the GPU by a Miri program.",
    life: "Conway's Game of Life running on the GPU by a Miri program.",
    particles: "A curl-noise particle flow field of 147,456 particles rendered on the GPU by a Miri program.",
    fluid: "A stable-fluids simulation with a Jacobi pressure solve, rendered on the GPU by a Miri program.",
    raymarch: "A ray-marched signed-distance-field scene rendered on the GPU by a Miri program.",
    neural: "A small neural network training live on the GPU, painted as a decision field by a Miri program.",
    blackhole: "Gravitationally lensed black hole with accretion disk, rendered on the GPU by a Miri program.",
    wormhole: "A traversable Morris–Thorne wormhole rendered on the GPU by a Miri program.",
};

// How many demos keep their device buffers while the reader scrolls. Scrolling
// the page eventually brings every demo into view, and their combined storage
// runs to a few hundred megabytes, so residency is capped rather than merely
// paused: the least recently seen demo is released when the cap is exceeded.
//
// The homepage tiles its previews in a grid, so several are on screen together
// and a cap of three would evict one the reader can still see. Six covers the
// widest row plus its neighbours; the playground shows one demo at a time and
// needs far less.
const MAX_RESIDENT_PLAYGROUND = 3;
const MAX_RESIDENT_PREVIEW = 6;
let maxResident = MAX_RESIDENT_PLAYGROUND;

const UNSUPPORTED =
    "This browser does not support WebGPU, so the demo cannot run here. " +
    "The image is a still frame of it. Try Chrome, Edge, or Safari 26+.";

function compiledName(slug) {
    return COMPILED_NAME[slug] || slug;
}

// Newest-first list of the demos currently holding device memory.
const resident = [];

function evictBeyondCap() {
    while (resident.length > maxResident) {
        const demo = resident.pop();
        demo.release();
    }
}

function touch(demo) {
    const at = resident.indexOf(demo);
    if (at !== -1) resident.splice(at, 1);
    resident.unshift(demo);
    evictBeyondCap();
}

function showFallback(frame, slug) {
    const box = frame.querySelector(".demo-fallback");
    if (!box) return;
    // Nothing is live here, so the badge that says so has to go.
    const badge = frame.querySelector(".demo-badge");
    if (badge) badge.remove();
    if (!box.dataset.filled) {
        // The markup ships placeholder text; replace it rather than adding to
        // it, so the panel carries one message instead of two.
        box.textContent = "";
        const poster = new Image();
        poster.src = new URL(`${compiledName(slug)}.jpg`, POSTERS).href;
        poster.alt = POSTER_ALT[slug] || "";
        // A demo with no still frame yet must not leave a broken-image icon
        // sitting over the notice.
        poster.addEventListener("error", () => poster.remove());
        box.appendChild(poster);
        const note = document.createElement("p");
        note.textContent = UNSUPPORTED;
        box.appendChild(note);
        box.dataset.filled = "true";
    }
    box.classList.add("show");
}

// Demos that publish numbers beside their picture: which device buffer carries
// them, and how each value is worded. The compiled program owns the values —
// the page only formats what it reads back.
const READOUTS = {
    neural: {
        buffer: "stats",
        format: ([loss, accuracy, epoch]) => [
            String(Math.round(epoch)),
            loss.toFixed(3),
            `${Math.round(accuracy * 100)}%`,
        ],
    },
};

// Bind a demo's numeric readout to the slots in its control strip, or null when
// this demo publishes none (or is a preview card, which shows no text at all).
function makeStatsReadout(stage) {
    const spec = READOUTS[stage.dataset.demo];
    if (!spec) return null;
    const slots = [...stage.querySelectorAll(".nn-stats b")];
    if (slots.length === 0) return null;
    return {
        buffer: spec.buffer,
        onStats(values) {
            const text = spec.format(values);
            for (let i = 0; i < slots.length && i < text.length; i++) {
                slots[i].textContent = text[i];
            }
        },
    };
}

// Exponentially smoothed frame rate, so the readout is legible rather than
// flickering with every frame's jitter.
function makeFpsReadout(stage) {
    const el = stage.querySelector(".pg-fps b");
    if (!el) return () => {};
    let fps = 0;
    let sincePaint = 0;
    return (dt) => {
        if (!dt) return;
        fps = fps === 0 ? 1 / dt : fps * 0.9 + (0.1 / dt);
        sincePaint += dt;
        if (sincePaint < 0.25) return;
        sincePaint = 0;
        el.textContent = String(Math.round(fps));
    };
}

function createDemo(stage, mount) {
    const slug = stage.dataset.demo;
    const frame = stage.querySelector(".demo-canvas-frame") || stage;
    // A preview card is itself a link, so its demo must neither steer with the
    // pointer nor swallow the click that opens the playground.
    const preview = stage.hasAttribute("data-preview");
    const canvas = document.createElement("canvas");
    if (preview) canvas.style.pointerEvents = "none";
    frame.insertBefore(canvas, frame.firstChild);
    const onFrame = preview ? undefined : makeFpsReadout(stage);
    const readout = preview ? null : makeStatsReadout(stage);

    let handle = null;
    let failed = false;
    let inView = false;
    // Incremented on every release, so a mount that completes after the demo was
    // evicted or scrolled away can tell that its result is stale.
    let generation = 0;
    let mounting = false;

    // A demo should be running only while it is both in the viewport and on a
    // visible tab. Keeping those two conditions in one place is what stops a
    // demo from staying paused after the reader returns to the tab.
    function shouldRun() {
        return inView && !document.hidden;
    }

    async function start() {
        if (failed || mounting) return;
        mounting = true;
        const era = generation;
        try {
            const url = new URL(`${compiledName(slug)}.json`, BUNDLES);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`${url.pathname}: HTTP ${response.status}`);
            }
            const mounted = await mount(canvas, await response.json(), {
                onFrame,
                input: !preview,
                onStats: readout ? readout.onStats : undefined,
                statsBuffer: readout ? readout.buffer : undefined,
            });
            if (era !== generation || !shouldRun()) {
                mounted.stop();
                return;
            }
            handle = mounted;
            touch(demo);
        } catch (err) {
            failed = true;
            console.error(`[miri-demos] ${slug}: ${err && err.message ? err.message : err}`);
            canvas.remove();
            showFallback(frame, slug);
        } finally {
            mounting = false;
        }
    }

    const demo = {
        slug,
        // Give the device memory back but stay ready to mount again if the
        // reader scrolls back to this demo.
        release() {
            generation++;
            if (handle) {
                handle.stop();
                handle = null;
            }
        },
        sync() {
            if (!shouldRun()) {
                if (handle) handle.pause();
                return;
            }
            if (handle) {
                handle.resume();
                touch(demo);
                return;
            }
            start();
        },
        setInView(value) {
            inView = value;
            demo.sync();
        },
    };
    return demo;
}

async function main() {
    // The playground's full-size stages and the homepage's preview cards. Both
    // run the same compiled bundles; a preview differs only in that it does not
    // take pointer input and reports no frame rate.
    const stages = [...document.querySelectorAll(".pg-stage[data-demo], .demo-card[data-demo]")];
    if (stages.length === 0) return;
    if (stages.some((s) => s.hasAttribute("data-preview"))) {
        maxResident = MAX_RESIDENT_PREVIEW;
    }

    let mount;
    try {
        if (typeof navigator === "undefined" || !navigator.gpu) {
            throw new Error("navigator.gpu is undefined");
        }
        ({ mount } = await import(RUNTIME.href));
    } catch (err) {
        console.warn(`[miri-demos] WebGPU unavailable: ${err && err.message ? err.message : err}`);
        for (const stage of stages) {
            showFallback(stage.querySelector(".demo-canvas-frame") || stage, stage.dataset.demo);
        }
        return;
    }

    const demos = stages.map((stage) => createDemo(stage, mount));
    const byStage = new Map(stages.map((stage, i) => [stage, demos[i]]));

    const MARGIN = 120;
    let delivered = false;

    const observer = new IntersectionObserver(
        (entries) => {
            delivered = true;
            for (const entry of entries) {
                const demo = byStage.get(entry.target);
                if (demo) demo.setInView(entry.isIntersecting);
            }
        },
        { rootMargin: `${MARGIN}px` },
    );
    for (const stage of stages) observer.observe(stage);

    // An IntersectionObserver is an optimization, not a guarantee: a tab that
    // the compositor considers occluded can go without a single delivery, which
    // would leave every demo unmounted and the page looking broken. If nothing
    // has arrived shortly after load, fall back to measuring the stages
    // directly, on scroll and resize, for the rest of the session.
    setTimeout(() => {
        if (delivered) return;
        observer.disconnect();

        const onScreen = (stage) => {
            const rect = stage.getBoundingClientRect();
            const height = window.innerHeight || document.documentElement.clientHeight;
            return rect.bottom > -MARGIN && rect.top < height + MARGIN;
        };
        let queued = false;
        const measure = () => {
            queued = false;
            for (const stage of stages) byStage.get(stage).setInView(onScreen(stage));
        };
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(measure);
        };
        addEventListener("scroll", schedule, { passive: true });
        addEventListener("resize", schedule, { passive: true });
        measure();
    }, 700);

    // Returning to the tab must resume whatever is still on screen, so both
    // directions re-evaluate rather than only pausing on the way out.
    document.addEventListener("visibilitychange", () => {
        for (const demo of demos) demo.sync();
    });
}

main();
