/* Miri syntax highlighter + small site utilities (nav, reveal, pixel icons, mobile menu) */
(function () {
  "use strict";

  // ---------- Miri tokenizer ----------
  var KEYWORDS = new RegExp(
    "\\b(use|let|var|fn|struct|enum|class|trait|match|if|else|for|in|while|return|" +
    "extends|implements|self|super|public|protected|private|abstract|out|as|and|or|not|" +
    "true|false|gpu|kernel|launch|forall|shared|frame|forever|until|unless|do|const|type|init|" +
    "async|await|break|continue)\\b"
  );
  var TYPES = /\b(int|float|bool|String|None|Some|List|Map|Buffer|Set|Array|Option|Result|void|i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f16|f32|f64|[A-Z][A-Za-z0-9_]*)\b/;
  var rules = [
    { cls: "tok-com", re: /\/\/[^\n]*/ },
    { cls: "tok-str", re: /f?"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
    { cls: "tok-kw", re: KEYWORDS },
    { cls: "tok-num", re: /\b\d[\d_]*(?:\.\d+)?\b/ },
    { cls: "tok-ty", re: TYPES },
    { cls: "tok-fn", re: /\b[a-z_][A-Za-z0-9_]*(?=\s*\()/ }
  ];

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightMiri(src) {
    var out = "";
    var rest = src;
    while (rest.length) {
      var best = null, bestIdx = Infinity, bestRule = null;
      for (var i = 0; i < rules.length; i++) {
        var m = rest.match(rules[i].re);
        if (m && m.index < bestIdx) {
          best = m; bestIdx = m.index; bestRule = rules[i];
        }
      }
      if (!best) { out += esc(rest); break; }
      out += esc(rest.slice(0, bestIdx));
      var text = best[0];
      // interpolation inside f-strings
      if (bestRule.cls === "tok-str" && text.indexOf("{") !== -1) {
        out += '<span class="tok-str">' +
          esc(text).replace(/\{[^}]*\}/g, function (g) {
            return '</span><span class="tok-int">' + g + '</span><span class="tok-str">';
          }) + "</span>";
      } else {
        out += '<span class="' + bestRule.cls + '">' + esc(text) + "</span>";
      }
      rest = rest.slice(bestIdx + text.length);
    }
    return out;
  }

  function highlightAll(root) {
    root = root || document;
    // mock-style blocks: <pre class="lang-miri">
    var pres = root.querySelectorAll("pre.lang-miri:not([data-hl])");
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      var src = pre.textContent.replace(/^\n+/, "").replace(/\s+$/, "");
      pre.innerHTML = highlightMiri(src);
      pre.setAttribute("data-hl", "1");
    }
    // Jekyll docs blocks: <pre><code class="language-miri">
    var codes = root.querySelectorAll("code.language-miri:not([data-hl])");
    for (var j = 0; j < codes.length; j++) {
      var code = codes[j];
      var s = code.textContent.replace(/^\n+/, "").replace(/\s+$/, "");
      code.innerHTML = highlightMiri(s);
      code.setAttribute("data-hl", "1");
    }
  }

  // ---------- pixel icons ----------
  // data-px is a string of 25 chars ('1' = lit cell), row-major 5x5
  function buildPixelIcons() {
    var els = document.querySelectorAll(".pix[data-px]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length) continue;
      var bits = el.getAttribute("data-px");
      var html = "";
      for (var j = 0; j < 25; j++) {
        html += bits.charAt(j) === "1" ? '<i class="on"></i>' : "<i></i>";
      }
      el.innerHTML = html;
    }
  }

  // ---------- dead-animation probe ----------
  function initAnimProbe() {
    var style = document.createElement("style");
    style.textContent = "@keyframes __miriProbe { to { opacity: 1; } }";
    document.head.appendChild(style);
    var d = document.createElement("div");
    d.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" +
      "pointer-events:none;animation:__miriProbe 0.05s linear forwards;";
    document.body.appendChild(d);
    setTimeout(function () {
      if (getComputedStyle(d).opacity !== "1") {
        document.documentElement.classList.add("no-anim");
      }
      d.remove();
      style.remove();
    }, 450);
  }

  // ---------- nav scroll state ----------
  function initNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    if (nav.classList.contains("nav-static")) return; // docs/playground stay solid
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 24);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- mobile menu ----------
  function initMobileMenu() {
    var toggle = document.querySelector(".nav-toggle");
    var links = document.querySelector(".nav-links");
    if (!toggle || !links) return;
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ---------- reveal on scroll ----------
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length || !("IntersectionObserver" in window)) {
      els.forEach && els.forEach(function (e) { e.classList.add("in"); });
      return;
    }
    var delivered = false;
    var io = new IntersectionObserver(function (entries) {
      delivered = true;
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    for (var i = 0; i < els.length; i++) io.observe(els[i]);
    setTimeout(function () {
      if (delivered) return;
      io.disconnect();
      for (var j = 0; j < els.length; j++) {
        els[j].style.transition = "none";
        els[j].classList.add("in");
      }
    }, 700);
  }

  // ---------- docs scrollspy ----------
  function initDocsSpy() {
    var links = document.querySelectorAll(".docs-side a[href^='#']");
    if (!links.length) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var headings = document.querySelectorAll(".docs-main h2[id]");
    if (!headings.length) return;
    var current = null;
    function setActive(link) {
      if (current === link) return;
      if (current) current.classList.remove("active");
      current = link;
      if (current) current.classList.add("active");
    }
    function useScrollSpy() {
      function onScroll() {
        var best = null;
        headings.forEach(function (h) {
          if (h.getBoundingClientRect().top < window.innerHeight * 0.35) best = h;
        });
        setActive(best ? map[best.id] : null);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
    if (!("IntersectionObserver" in window)) return useScrollSpy();
    var delivered = false;
    var io = new IntersectionObserver(function (entries) {
      delivered = true;
      entries.forEach(function (en) {
        if (en.isIntersecting) setActive(map[en.target.id]);
      });
    }, { rootMargin: "-15% 0px -70% 0px" });
    headings.forEach(function (h) { io.observe(h); });
    setTimeout(function () {
      if (delivered) return;
      io.disconnect();
      useScrollSpy();
    }, 700);
  }

  window.MiriSite = { highlightMiri: highlightMiri, highlightAll: highlightAll };

  document.addEventListener("DOMContentLoaded", function () {
    highlightAll();
    buildPixelIcons();
    initNav();
    initMobileMenu();
    initReveal();
    initDocsSpy();
    initAnimProbe();
  });
})();
