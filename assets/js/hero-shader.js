/* Hero background shader — flowing "compute grid" of glowing cells (brand pixel motif) */
(function () {
  "use strict";

  var FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform vec2 u_res;",
    "uniform float u_t;",
    "uniform vec2 u_mouse;",

    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),",
    "             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);",
    "}",
    "float fbm(vec2 p){",
    "  float v = 0.0, a = 0.5;",
    "  for(int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + 17.7; a *= 0.5; }",
    "  return v;",
    "}",
    "float roundedSq(vec2 p, float r){",
    "  vec2 d = abs(p) - vec2(0.5 - r);",
    "  return length(max(d, 0.0)) - r;",
    "}",

    "void main(){",
    "  vec2 frag = v_uv * u_res;",
    "  float cell = clamp(u_res.y / 26.0, 22.0, 46.0);",
    "  vec2 gv = frag / cell;",
    "  vec2 id = floor(gv);",
    "  vec2 lp = fract(gv) - 0.5;",

    "  vec2 uvn = frag / u_res;",
    "  float t = u_t * 0.22;",
    "  float field = fbm(id * 0.16 + vec2(t, -t * 0.6));",
    "  field += 0.35 * fbm(id * 0.05 - vec2(t * 0.4, t * 0.25));",

    "  vec2 m = u_mouse;",
    "  float md = length((uvn - m) * vec2(u_res.x / u_res.y, 1.0));",
    "  float mGlow = exp(-md * 5.5) * 0.8;",
    "  field += mGlow;",

    "  float h = hash(id);",
    "  float spark = step(0.995, hash(id + floor(u_t * vec2(0.5, 0.31))));",
    "  float lvl = smoothstep(0.62, 1.15, field + h * 0.12);",

    "  float d = roundedSq(lp, 0.18);",
    "  float sq = 1.0 - smoothstep(-0.08, 0.02, d);",
    "  float glow = exp(-max(d, 0.0) * 9.0);",

    "  vec3 base = vec3(0.016, 0.027, 0.059);",
    "  vec3 cellDim = vec3(0.045, 0.075, 0.16);",
    "  vec3 blue = vec3(0.21, 0.36, 0.85);",
    "  vec3 yellow = vec3(1.0, 0.84, 0.24);",

    "  vec3 col = base;",
    "  col = mix(col, cellDim, sq * 0.85);",
    "  col += blue * (sq * lvl * 0.55 + glow * lvl * 0.35);",
    "  float yMask = smoothstep(0.88, 1.25, field + h * 0.1) + spark * lvl;",
    "  col += yellow * (sq * yMask * 0.9 + glow * yMask * 0.5);",
    "  col += yellow * mGlow * glow * 0.45;",

    "  float vig = smoothstep(1.45, 0.35, length(uvn - vec2(0.5, 0.42)));",
    "  col *= mix(0.55, 1.0, vig);",
    "  float fadeB = smoothstep(0.0, 0.38, uvn.y);",       // fade to page bg at bottom
    "  col = mix(vec3(0.016, 0.027, 0.059), col, fadeB);",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function initHero(canvas) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var p = MiriGL.program(gl, MiriGL.QUAD_VS, FS);
    var q = MiriGL.quad(gl);
    var mouse = [0.5, 0.45], target = [0.5, 0.45];

    window.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      target[0] = (e.clientX - r.left) / r.width;
      target[1] = 1.0 - (e.clientY - r.top) / r.height;
    }, { passive: true });

    var l = MiriGL.loop(function (dt, t) {
      MiriGL.resize(gl, canvas, 1.5);
      mouse[0] += (target[0] - mouse[0]) * 0.06;
      mouse[1] += (target[1] - mouse[1]) * 0.06;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(p.prog);
      gl.uniform2f(p.u.u_res, canvas.width, canvas.height);
      gl.uniform1f(p.u.u_t, t);
      gl.uniform2f(p.u.u_mouse, mouse[0], mouse[1]);
      q.draw();
    });
    return l;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var canvas = document.getElementById("hero-gl");
    if (!canvas) return;
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      var l = initHero(canvas);
      if (!l) return;
      l.start();
      if (reduced) setTimeout(function () { l.stop(); }, 400);
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) l.stop(); else if (!reduced) l.start();
      });
    } catch (e) {
      console.warn("hero shader unavailable", e);
    }
  });
})();
