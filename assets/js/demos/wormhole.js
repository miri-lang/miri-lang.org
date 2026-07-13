/* Demo: Morris–Thorne wormhole — light traversing a traversable throat.
   One fragment shader. Each pixel integrates a null geodesic through the throat geometry
   r(ℓ) = √(k² + max(0,|ℓ|-a)²) using the compact ODE  ℓ̈ = b²·r'(ℓ)/r³  (b = impact
   parameter, conserved), the same plane-reduction trick as the black hole. Rays with b < k
   fall through the throat and sample the *other* universe's sky; rays with b > k turn around
   and show a gravitationally-lensed view of our own. Most pixels escape in a handful of steps. */
(function () {
  "use strict";

  var FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform vec2 u_res;",
    "uniform float u_t;",
    "uniform vec2 u_rot;",   // yaw, pitch
    "uniform float u_dist;", // camera distance
    "uniform int  u_steps;",

    // ---- hashing / noise ----
    "float hash21(vec2 p){",
    "  p = fract(p * vec2(123.34, 345.45));",
    "  p += dot(p, p + 34.345);",
    "  return fract(p.x * p.y);",
    "}",
    "float hash31(vec3 p){",
    "  p = fract(p * 0.3183099 + 0.1);",
    "  p *= 17.0;",
    "  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));",
    "}",
    "float vnoise(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));",
    "  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));",
    "  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);",
    "}",
    "float fbm(vec2 p){",
    "  float s = 0.0, a = 0.5;",
    "  for(int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.02; a *= 0.5; }",
    "  return s;",
    "}",

    // ---- one starfield layer over a sphere of directions ----
    "float starLayer(vec3 d, float scale, float thr){",
    "  vec3 p = d * scale;",
    "  vec3 id = floor(p);",
    "  vec3 f = fract(p) - 0.5;",
    "  float h = hash31(id);",
    "  vec3 off = vec3(hash31(id + 1.3), hash31(id + 2.7), hash31(id + 4.1)) - 0.5;",
    "  float star = smoothstep(0.5, 0.0, length(f - off * 0.7));",
    "  float on = step(1.0 - thr, h);",
    "  return star * star * on * (0.4 + 0.6 * fract(h * 91.7));",
    "}",
    // our universe: warm, quiet
    "vec3 skyHome(vec3 d){",
    "  vec3 col = vec3(0.0);",
    "  col += vec3(1.0, 0.93, 0.82) * starLayer(d, 15.0, 0.05);",
    "  col += vec3(1.0, 0.86, 0.7) * starLayer(d, 32.0, 0.035) * 0.8;",
    "  col += vec3(0.9, 0.8, 0.7) * starLayer(d, 64.0, 0.02) * 0.5;",
    "  float n = fbm(vec2(d.x * 2.0 + d.z, d.y * 2.0 - d.z) * 1.4 + 11.0);",
    "  col += vec3(0.08, 0.05, 0.03) * n * n;",
    "  col += vec3(0.018, 0.02, 0.03) * 0.4;",
    "  return col;",
    "}",
    // the far universe seen through the throat: cool, luminous
    "vec3 skyFar(vec3 d){",
    "  vec3 col = vec3(0.0);",
    "  col += vec3(0.8, 0.92, 1.0) * starLayer(d, 17.0, 0.06);",
    "  col += vec3(0.85, 0.95, 1.0) * starLayer(d, 36.0, 0.04) * 0.85;",
    "  col += vec3(0.9, 0.97, 1.0) * starLayer(d, 70.0, 0.025) * 0.55;",
    // bright nebular glow so the mouth reads as luminous
    "  float g = fbm(vec2(d.x * 1.6 - d.y, d.z * 1.6 + d.y) * 1.2 + 3.0);",
    "  col += vec3(0.12, 0.28, 0.55) * (0.35 + 0.9 * g * g);",
    "  col += vec3(0.06, 0.15, 0.34);",     // deep blue base
    "  return col;",
    "}",

    "const float K = 1.0;",   // throat radius
    "const float A = 0.9;",   // throat half-length (flat tube)

    "void main(){",
    "  vec2 uv = (v_uv - 0.5);",
    "  uv.x *= u_res.x / u_res.y;",

    "  float ya = u_rot.x;",
    "  float pa = clamp(u_rot.y, -1.45, 1.45);",
    "  vec3 ro = vec3(cos(ya) * cos(pa), sin(pa), sin(ya) * cos(pa)) * u_dist;",
    "  vec3 fw = normalize(-ro);",
    "  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));",
    "  vec3 up = cross(rt, fw);",
    "  vec3 rd = normalize(fw * 1.7 + rt * uv.x + up * uv.y);",

    // reduce to the ray's plane {e1 = radial, e2 = forward-tangent}
    "  float r0 = length(ro);",
    "  vec3 e1 = ro / r0;",
    "  vec3 nrm = cross(e1, rd);",
    "  float nl = length(nrm);",
    "  nrm = nl < 1e-4 ? vec3(0.0, 1.0, 0.0) : nrm / nl;",
    "  vec3 e2 = normalize(cross(nrm, e1));",
    "  if(dot(rd, e2) < 0.0) e2 = -e2;",

    // proper radial coordinate ℓ on our side (r0 = sqrt(K² + (ℓ-A)²))
    "  float l = A + sqrt(max(r0 * r0 - K * K, 0.0));",
    "  float vt = dot(rd, e2);",        // tangential
    "  float b = r0 * vt;",             // impact parameter (conserved)
    "  float ldot = dot(rd, e1);",      // dℓ/dλ (inward is negative)

    "  float phi = 0.0;",
    "  float r = r0;",
    "  float minR = r0;",

    "  for(int i = 0; i < 260; i++){",
    "    if(i >= u_steps) break;",
    "    float m = max(0.0, abs(l) - A);",
    "    r = sqrt(K * K + m * m);",
    "    float rp = abs(l) > A ? sign(l) * m / r : 0.0;",   // dr/dℓ
    "    float dl = mix(0.03, 0.18, clamp((r - 2.0) / 12.0, 0.0, 1.0));",
    // symplectic step of  ℓ̈ = b²·r'/r³
    "    ldot += (b * b * rp / (r * r * r)) * dl;",
    "    l    += ldot * dl;",
    "    phi  += (b / (r * r)) * dl;",
    "    r = sqrt(K * K + pow(max(0.0, abs(l) - A), 2.0));",
    "    minR = min(minR, r);",
    "    if(r > 16.0) break;",   // escaped to (either) asymptotic space
    "  }",

    // exit direction from the analytic plane velocity  v = ℓ̇·r'·ê_r + (b/r)·ê_t
    "  float m = max(0.0, abs(l) - A);",
    "  float rf = sqrt(K * K + m * m);",
    "  float rp = abs(l) > A ? sign(l) * m / rf : 0.0;",
    "  float cp = cos(phi), sp = sin(phi);",
    "  vec3 er = cp * e1 + sp * e2;",
    "  vec3 et = -sp * e1 + cp * e2;",
    "  vec3 vel = rp * ldot * er + (b / rf) * et;",
    "  vec3 dir = length(vel) < 1e-5 ? er : normalize(vel);",
    "  vec3 col = (l < 0.0) ? skyFar(dir) : skyHome(dir);",

    // Einstein ring: light grazing the throat (minR -> K) piles up into a bright rim
    "  float ring = exp(-12.0 * (minR - K) * (minR - K)) * smoothstep(0.0, 0.6, minR - K);",
    "  col += vec3(1.0, 0.7, 0.4) * ring * 1.3;",
    // soft blue bloom bleeding out of the mouth
    "  float mouth = exp(-2.2 * max(0.0, minR - K));",
    "  col += vec3(0.15, 0.32, 0.6) * mouth * 0.35;",

    "  col = col / (col + vec3(0.85));",
    "  col = pow(col, vec3(0.82));",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  MiriDemos.register("wormhole", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var p = MiriGL.program(gl, MiriGL.QUAD_VS, FS);
    var q = MiriGL.quad(gl);

    var rot = { x: 1.15, y: 0.25 };
    var dist = 6.5;
    var dragging = false, lastX = 0, lastY = 0;
    var steps = opts.preview ? 200 : 220;

    if (!opts.preview) {
      canvas.style.cursor = "grab";
      canvas.addEventListener("pointerdown", function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        rot.x += (e.clientX - lastX) * 0.008;
        rot.y += (e.clientY - lastY) * 0.006;
        rot.y = Math.max(-1.45, Math.min(1.45, rot.y));
        lastX = e.clientX; lastY = e.clientY;
      });
      canvas.addEventListener("pointerup", function () {
        dragging = false; canvas.style.cursor = "grab";
      });
      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        dist *= Math.exp(e.deltaY * 0.0012);
        dist = Math.max(3.5, Math.min(22.0, dist));
      }, { passive: false });
    }

    var l = MiriGL.loop(function (dt, t) {
      if (opts.preview || !dragging) rot.x += dt * 0.09;   // auto-orbit unless actively dragging
      MiriGL.resize(gl, canvas, Math.min(opts.dprCap, 1.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(p.prog);
      gl.uniform2f(p.u.u_res, canvas.width, canvas.height);
      gl.uniform1f(p.u.u_t, t);
      gl.uniform2f(p.u.u_rot, rot.x, rot.y);
      gl.uniform1f(p.u.u_dist, dist);
      gl.uniform1i(p.u.u_steps, steps);
      q.draw();
    });
    return l;
  });
})();
