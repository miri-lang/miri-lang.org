/* Demo: Mandelbrot — escape-time fractal in a fragment shader */
(function () {
  "use strict";

  var FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform vec2 u_res;",
    "uniform vec2 u_center;",
    "uniform float u_scale;",
    "uniform float u_iter;",

    "vec3 palette(float t){",
    "  vec3 navy = vec3(0.016, 0.027, 0.059);",
    "  vec3 blue = vec3(0.13, 0.27, 0.75);",
    "  vec3 cyan = vec3(0.35, 0.62, 1.0);",
    "  vec3 yellow = vec3(1.0, 0.85, 0.24);",
    "  vec3 white = vec3(1.0, 0.97, 0.85);",
    "  t = fract(t);",
    "  if(t < 0.35) return mix(navy, blue, t / 0.35);",
    "  if(t < 0.62) return mix(blue, cyan, (t - 0.35) / 0.27);",
    "  if(t < 0.85) return mix(cyan, yellow, (t - 0.62) / 0.23);",
    "  return mix(yellow, white, (t - 0.85) / 0.15);",
    "}",

    "void main(){",
    "  vec2 uv = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);",
    "  vec2 c = u_center + uv * u_scale;",
    "  vec2 z = vec2(0.0);",
    "  float n = -1.0;",
    "  int maxIter = int(u_iter);",
    "  for(int i = 0; i < 900; i++){",
    "    if(i >= maxIter) break;",
    "    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;",
    "    if(dot(z, z) > 64.0){ n = float(i); break; }",
    "  }",
    "  vec3 col;",
    "  if(n < 0.0){",
    "    col = vec3(0.008, 0.012, 0.03);",
    "  } else {",
    "    float sn = n - log2(log2(dot(z, z))) + 4.0;",
    "    col = palette(sn * 0.022 + 0.62);",
    "    col *= 0.55 + 0.45 * smoothstep(0.0, 12.0, sn);",
    "  }",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  MiriDemos.register("mandelbrot", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var p = MiriGL.program(gl, MiriGL.QUAD_VS, FS);
    var q = MiriGL.quad(gl);

    // seahorse valley target for the preview fly-in
    var tour = { x: -0.74364388703, y: 0.13182590421 };
    var center = { x: -0.6, y: 0.0 };
    var scale = 3.0;
    var dragging = false, lastX = 0, lastY = 0;
    var t0 = 0;

    if (!opts.preview) {
      canvas.style.cursor = "grab";
      canvas.addEventListener("pointerdown", function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var r = canvas.getBoundingClientRect();
        center.x -= (e.clientX - lastX) / r.height * scale;
        center.y += (e.clientY - lastY) / r.height * scale;
        lastX = e.clientX; lastY = e.clientY;
      });
      canvas.addEventListener("pointerup", function () {
        dragging = false; canvas.style.cursor = "grab";
      });
      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        var r = canvas.getBoundingClientRect();
        var ux = ((e.clientX - r.left) / r.width - 0.5) * (r.width / r.height);
        var uy = -((e.clientY - r.top) / r.height - 0.5);
        var f = Math.exp(e.deltaY * 0.0014);
        f = Math.max(0.6, Math.min(1.6, f));
        var ns = Math.max(2e-5, Math.min(4.0, scale * f));
        var k = 1 - ns / scale;
        center.x += ux * scale * k;
        center.y += uy * scale * k;
        scale = ns;
      }, { passive: false });
    }

    var l = MiriGL.loop(function (dt, t) {
      if (!t0) t0 = t;
      if (opts.preview) {
        // gentle breathing zoom loop into seahorse valley
        var phase = ((t - t0) % 26) / 26;
        var depth = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
        scale = 3.0 * Math.pow(0.0012, depth);
        var mixK = 1.0 - scale / 3.0;
        center.x = -0.6 + (tour.x + 0.6) * mixK;
        center.y = tour.y * mixK;
      }
      MiriGL.resize(gl, canvas, opts.dprCap);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(p.prog);
      gl.uniform2f(p.u.u_res, canvas.width, canvas.height);
      gl.uniform2f(p.u.u_center, center.x, center.y);
      gl.uniform1f(p.u.u_scale, scale);
      var iter = Math.min(880.0, 120.0 + 60.0 * Math.log2(3.0 / scale + 1.0) * 2.2);
      gl.uniform1f(p.u.u_iter, iter);
      q.draw();
    });
    return l;
  });
})();
