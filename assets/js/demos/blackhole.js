/* Demo: Schwarzschild black hole — photon geodesics, gravitational lensing, accretion disk.
   One fragment shader. Each pixel integrates a null geodesic in the photon's orbital plane
   using the compact 2D ODE  d²u/dφ² = -u + (3/2)·rs·u²  (u = 1/r), which is far cheaper than
   full 3D RK4 through the metric yet reproduces the light-bending, the Einstein ring and the
   warped-disk silhouette. Background rays escape in a handful of steps, so cost stays bounded. */
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
    "uniform float u_dist;", // camera distance (Schwarzschild radii)
    "uniform int  u_steps;", // integration budget (quality)

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

    // ---- starfield + nebula behind everything ----
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
    "vec3 background(vec3 d){",
    "  vec3 col = vec3(0.0);",
    "  col += vec3(0.85, 0.92, 1.0) * starLayer(d, 14.0, 0.05);",
    "  col += vec3(1.0, 0.9, 0.78) * starLayer(d, 30.0, 0.035) * 0.8;",
    "  col += vec3(0.7, 0.8, 1.0) * starLayer(d, 60.0, 0.02) * 0.5;",
    "  float n = fbm(vec2(d.x * 2.0 + d.z, d.y * 2.0 - d.z) * 1.4 + 5.0);",
    "  col += vec3(0.06, 0.03, 0.11) * n * n;",           // faint purple nebula
    "  col += vec3(0.02, 0.03, 0.05) * 0.35;",            // deep-space floor
    "  return col;",
    "}",

    // ---- accretion disk (equatorial plane y = 0) ----
    "const float R_IN  = 2.6;",   // inner edge (~ISCO-ish, rs = 1)
    "const float R_OUT = 9.0;",
    "float diskOpacity(float r){",
    "  return 0.9 * smoothstep(R_IN, R_IN + 0.5, r) * (1.0 - smoothstep(R_OUT - 2.5, R_OUT, r));",
    "}",
    "vec3 diskEmission(float r, vec3 p, vec3 travel, float t){",
    "  float x = clamp((r - R_IN) / (R_OUT - R_IN), 0.0, 1.0);",
    "  float ang = atan(p.z, p.x);",
    // Keplerian shear: inner material orbits faster -> co-rotating texture coord
    "  float omega = pow(R_IN / r, 1.5);",
    "  float rot = t * omega * 0.9;",
    "  float bands = fbm(vec2((ang - rot) * 2.5, r * 1.3));",
    "  bands = 0.35 + 1.25 * bands * bands;",
    // temperature: hot white-orange inner -> cool red outer
    "  vec3 hot  = vec3(1.0, 0.92, 0.78);",
    "  vec3 mid  = vec3(1.0, 0.55, 0.18);",
    "  vec3 cool = vec3(0.85, 0.2, 0.05);",
    "  vec3 c = mix(hot, mid, smoothstep(0.0, 0.35, x));",
    "  c = mix(c, cool, smoothstep(0.35, 1.0, x));",
    // relativistic Doppler beaming: approaching side brighter + bluer
    "  vec3 orbitDir = normalize(cross(vec3(0.0, 1.0, 0.0), p));",
    "  float beta = min(sqrt(0.5 / r), 0.75);",           // v/c, M = rs/2 = 0.5
    "  float g = 1.0 / sqrt(1.0 - beta * beta);",
    "  float delta = 1.0 / (g * (1.0 - dot(orbitDir * beta, travel)));",
    "  float boost = pow(clamp(delta, 0.2, 3.0), 3.0);",
    "  c *= mix(vec3(1.0, 0.55, 0.35), vec3(0.75, 0.85, 1.2), clamp((delta - 0.85) * 1.2, 0.0, 1.0));",
    // gravitational redshift dimming near the horizon
    "  float grav = sqrt(clamp(1.0 - 1.0 / r, 0.04, 1.0));",
    "  float bright = mix(1.7, 0.5, x);",
    "  return c * bands * bright * boost * grav;",
    "}",

    "void main(){",
    "  vec2 uv = (v_uv - 0.5);",
    "  uv.x *= u_res.x / u_res.y;",

    // camera orbiting the black hole
    "  float ya = u_rot.x;",
    "  float pa = clamp(u_rot.y, -1.45, 1.45);",
    "  vec3 ro = vec3(cos(ya) * cos(pa), sin(pa), sin(ya) * cos(pa)) * u_dist;",
    "  vec3 fw = normalize(-ro);",
    "  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));",
    "  vec3 up = cross(rt, fw);",
    "  vec3 rd = normalize(fw * 1.7 + rt * uv.x + up * uv.y);",

    // set up the photon's orbital plane: {e1 = radial, e2 = forward-tangent}
    "  vec3 pos = ro;",
    "  float r = length(pos);",
    "  vec3 e1 = pos / r;",
    "  vec3 nrm = cross(e1, rd);",
    "  float nl = length(nrm);",
    "  nrm = nl < 1e-4 ? vec3(0.0, 1.0, 0.0) : nrm / nl;",
    "  vec3 e2 = normalize(cross(nrm, e1));",
    "  if(dot(rd, e2) < 0.0) e2 = -e2;",

    "  float u = 1.0 / r;",
    "  float vr = dot(rd, e1);",
    "  float vt = dot(rd, e2);",
    "  float du = -u * vr / max(vt, 1e-3);",   // du/dφ at φ = 0

    "  float phi = 0.0;",
    "  vec3 col = vec3(0.0);",
    "  float trans = 1.0;",
    "  float prevY = pos.y, prevR = r;",
    "  vec3 prevPos = pos;",
    "  bool captured = false;",

    "  for(int i = 0; i < 320; i++){",
    "    if(i >= u_steps) break;",
    "    float dphi = mix(0.028, 0.11, clamp((r - 3.0) / 14.0, 0.0, 1.0));",
    // symplectic (semi-implicit) step of  u'' = -u + 1.5·u²   (rs = 1)
    "    float acc = -u + 1.5 * u * u;",
    "    du += acc * dphi;",
    "    u  += du * dphi;",
    "    phi += dphi;",
    "    r = 1.0 / max(u, 1e-4);",
    "    pos = r * (cos(phi) * e1 + sin(phi) * e2);",

    "    if(r < 1.02){ captured = true; break; }",   // crossed event horizon

    // equatorial-plane crossing -> sample disk (front-to-back compositing)
    "    if(prevY * pos.y < 0.0){",
    "      float f = prevY / (prevY - pos.y);",
    "      float cr = mix(prevR, r, f);",
    "      if(cr > R_IN && cr < R_OUT){",
    "        vec3 cp = mix(prevPos, pos, f);",
    "        vec3 travel = normalize(pos - prevPos);",
    "        col += trans * diskEmission(cr, cp, travel, u_t);",
    "        trans *= 1.0 - diskOpacity(cr);",
    "      }",
    "    }",

    "    if(r > 60.0) break;",                        // escaped to infinity
    "    if(trans < 0.01) break;",
    "    prevY = pos.y; prevR = r; prevPos = pos;",
    "  }",

    "  if(!captured){",
    "    vec3 dir = normalize(pos - prevPos);",       // lensed exit direction
    "    col += trans * background(dir);",
    "  }",

    // tonemap + gentle bloom-ish lift on the bright disk
    "  col *= 1.05;",
    "  col = col / (col + vec3(0.85));",
    "  col = pow(col, vec3(0.82));",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  MiriDemos.register("blackhole", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var p = MiriGL.program(gl, MiriGL.QUAD_VS, FS);
    var q = MiriGL.quad(gl);

    var rot = { x: 1.15, y: 0.18 };   // near edge-on: iconic warped-disk view
    var dist = 19.5;
    var dragging = false, lastX = 0, lastY = 0;
    var steps = opts.preview ? 240 : 260;

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
        dist = Math.max(4.5, Math.min(28.0, dist));
      }, { passive: false });
    }

    var l = MiriGL.loop(function (dt, t) {
      if (opts.preview || !dragging) rot.x += dt * 0.08;   // auto-orbit unless actively dragging
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
