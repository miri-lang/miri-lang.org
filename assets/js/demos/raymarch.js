/* Demo: Ray-marched 3D — signed distance fields, soft shadows, one fragment shader */
(function () {
  "use strict";

  var FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform vec2 u_res;",
    "uniform float u_t;",
    "uniform vec2 u_rot;",

    "float smin(float a, float b, float k){",
    "  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);",
    "  return mix(b, a, h) - k * h * (1.0 - h);",
    "}",
    "float sdSphere(vec3 p, float r){ return length(p) - r; }",
    "float sdBox(vec3 p, vec3 b){",
    "  vec3 q = abs(p) - b;",
    "  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);",
    "}",

    "float map(vec3 p){",
    "  float t = u_t * 0.6;",
    "  vec3 c1 = vec3(sin(t) * 0.7, 0.9 + sin(t * 1.3) * 0.25, cos(t * 0.8) * 0.7);",
    "  vec3 c2 = vec3(cos(t * 1.1) * 0.8, 0.9 + cos(t * 0.7) * 0.3, sin(t * 1.4) * 0.6);",
    "  vec3 c3 = vec3(sin(t * 0.7 + 2.0) * 0.6, 1.0 + sin(t) * 0.2, cos(t * 1.2 + 1.0) * 0.8);",
    "  float blobs = sdSphere(p - c1, 0.42);",
    "  blobs = smin(blobs, sdSphere(p - c2, 0.34), 0.45);",
    "  blobs = smin(blobs, sdSphere(p - c3, 0.28), 0.45);",
    "  float cube = sdBox(p - vec3(0.0, 0.9, 0.0), vec3(0.26)) - 0.04;",
    "  blobs = smin(blobs, cube, 0.3);",
    "  float ground = p.y + 0.0;",
    "  return min(blobs, ground);",
    "}",

    "vec3 normal(vec3 p){",
    "  vec2 e = vec2(0.001, 0.0);",
    "  return normalize(vec3(",
    "    map(p + e.xyy) - map(p - e.xyy),",
    "    map(p + e.yxy) - map(p - e.yxy),",
    "    map(p + e.yyx) - map(p - e.yyx)));",
    "}",

    "float softShadow(vec3 ro, vec3 rd){",
    "  float res = 1.0, t = 0.04;",
    "  for(int i = 0; i < 40; i++){",
    "    float h = map(ro + rd * t);",
    "    if(h < 0.001) return 0.0;",
    "    res = min(res, 9.0 * h / t);",
    "    t += clamp(h, 0.02, 0.25);",
    "    if(t > 7.0) break;",
    "  }",
    "  return clamp(res, 0.0, 1.0);",
    "}",

    "void main(){",
    "  vec2 uv = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);",
    "  float ya = u_rot.x, pa = clamp(u_rot.y, 0.08, 1.25);",
    "  float cd = 3.6;",
    "  vec3 ro = vec3(cos(ya) * cos(pa), sin(pa), sin(ya) * cos(pa)) * cd + vec3(0.0, 0.7, 0.0);",
    "  vec3 ta = vec3(0.0, 0.75, 0.0);",
    "  vec3 fw = normalize(ta - ro);",
    "  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));",
    "  vec3 up = cross(rt, fw);",
    "  vec3 rd = normalize(fw * 1.6 + rt * uv.x + up * uv.y);",

    "  float t = 0.0; float hit = -1.0;",
    "  for(int i = 0; i < 110; i++){",
    "    vec3 p = ro + rd * t;",
    "    float d = map(p);",
    "    if(d < 0.0012 * t + 0.0006){ hit = t; break; }",
    "    t += d * 0.9;",
    "    if(t > 22.0) break;",
    "  }",

    "  vec3 sky = vec3(0.012, 0.02, 0.046);",
    "  vec3 col = sky * (1.0 + 0.5 * uv.y);",
    "  if(hit > 0.0){",
    "    vec3 p = ro + rd * hit;",
    "    vec3 n = normal(p);",
    "    vec3 keyDir = normalize(vec3(0.7, 0.9, -0.4));",
    "    vec3 fillDir = normalize(vec3(-0.6, 0.3, 0.7));",
    "    float key = max(dot(n, keyDir), 0.0) * softShadow(p + n * 0.01, keyDir);",
    "    float fill = max(dot(n, fillDir), 0.0);",
    "    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);",
    "    vec3 yellow = vec3(1.0, 0.82, 0.3);",
    "    vec3 blue = vec3(0.2, 0.34, 0.85);",
    "    vec3 albedo;",
    "    if(p.y < 0.003){",
    "      vec2 g = abs(fract(p.xz * 2.0) - 0.5);",
    "      float line = smoothstep(0.46, 0.5, max(g.x, g.y));",
    "      albedo = mix(vec3(0.02, 0.035, 0.08), blue * 0.35, line);",
    "    } else {",
    "      albedo = vec3(0.05, 0.08, 0.18);",
    "    }",
    "    col = albedo * (0.25 + key * yellow * 1.6 + fill * blue * 0.7);",
    "    col += fres * mix(blue, yellow, 0.4) * 0.5 * step(0.003, p.y);",
    "    float spec = pow(max(dot(reflect(-keyDir, n), -rd), 0.0), 40.0);",
    "    col += yellow * spec * key * 0.9;",
    "    col = mix(col, sky, smoothstep(6.0, 20.0, hit));",
    "  }",
    "  col = pow(col, vec3(0.92));",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  MiriDemos.register("raymarch", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var p = MiriGL.program(gl, MiriGL.QUAD_VS, FS);
    var q = MiriGL.quad(gl);

    var rot = { x: 0.7, y: 0.42 };
    var dragging = false, lastX = 0, lastY = 0, idle = 99;

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
        lastX = e.clientX; lastY = e.clientY;
        idle = 0;
      });
      canvas.addEventListener("pointerup", function () {
        dragging = false; canvas.style.cursor = "grab";
      });
    }

    var l = MiriGL.loop(function (dt, t) {
      idle += dt;
      if (opts.preview || idle > 4) rot.x += dt * 0.18;
      MiriGL.resize(gl, canvas, Math.min(opts.dprCap, 1.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(p.prog);
      gl.uniform2f(p.u.u_res, canvas.width, canvas.height);
      gl.uniform1f(p.u.u_t, t);
      gl.uniform2f(p.u.u_rot, rot.x, rot.y);
      q.draw();
    });
    return l;
  });
})();
