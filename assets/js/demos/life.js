/* Demo: Conway's Game of Life — ping-pong texture compute */
(function () {
  "use strict";

  var STEP_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform sampler2D u_state;",
    "uniform vec2 u_size;",
    "int alive(ivec2 p){",
    "  ivec2 s = ivec2(u_size);",
    "  p = (p + s) % s;",
    "  return texelFetch(u_state, p, 0).r > 0.5 ? 1 : 0;",
    "}",
    "void main(){",
    "  ivec2 p = ivec2(v_uv * u_size);",
    "  int n = 0;",
    "  for(int dy = -1; dy <= 1; dy++)",
    "    for(int dx = -1; dx <= 1; dx++)",
    "      if(dx != 0 || dy != 0) n += alive(p + ivec2(dx, dy));",
    "  vec4 prev = texelFetch(u_state, p, 0);",
    "  float was = prev.r;",
    "  float now = (was > 0.5) ? ((n == 2 || n == 3) ? 1.0 : 0.0) : (n == 3 ? 1.0 : 0.0);",
    "  float trail = max(prev.g * 0.94, was);",
    "  o = vec4(now, trail, 0.0, 1.0);",
    "}"
  ].join("\n");

  var SPLAT_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform sampler2D u_state;",
    "uniform vec2 u_size;",
    "uniform vec2 u_pos;",
    "uniform float u_radius;",
    "uniform float u_seed;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }",
    "void main(){",
    "  vec4 prev = texture(u_state, v_uv);",
    "  vec2 d = (v_uv - u_pos) * u_size;",
    "  if(length(d) < u_radius && hash(floor(v_uv * u_size)) > 0.45){",
    "    prev.r = 1.0;",
    "  }",
    "  o = prev;",
    "}"
  ].join("\n");

  var DRAW_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform sampler2D u_state;",
    "uniform vec2 u_size;",
    "void main(){",
    "  vec4 s = texture(u_state, v_uv);",
    "  vec2 cell = fract(v_uv * u_size);",
    "  vec2 e = abs(cell - 0.5);",
    "  float inner = 1.0 - smoothstep(0.32, 0.46, max(e.x, e.y));",
    "  vec3 bg = vec3(0.012, 0.02, 0.046);",
    "  vec3 yellow = vec3(1.0, 0.84, 0.24);",
    "  vec3 blue = vec3(0.18, 0.32, 0.8);",
    "  float trail = s.g * (1.0 - s.r);",
    "  vec3 col = bg;",
    "  col += blue * trail * trail * (0.25 + 0.75 * inner);",
    "  col += yellow * s.r * (0.22 + 0.95 * inner);",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  MiriDemos.register("life", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    var stepP = MiriGL.program(gl, MiriGL.QUAD_VS, STEP_FS);
    var splatP = MiriGL.program(gl, MiriGL.QUAD_VS, SPLAT_FS);
    var drawP = MiriGL.program(gl, MiriGL.QUAD_VS, DRAW_FS);
    var q = MiriGL.quad(gl);

    MiriGL.resize(gl, canvas, opts.dprCap);
    var simW = opts.preview ? 160 : 320;
    var simH = Math.max(40, Math.round(simW * canvas.clientHeight / Math.max(1, canvas.clientWidth)));

    var state = MiriGL.doubleFBO(gl, simW, simH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);

    function seed() {
      var data = new Uint8Array(simW * simH * 4);
      for (var i = 0; i < simW * simH; i++) {
        var on = Math.random() > 0.82 ? 255 : 0;
        data[i * 4] = on;
        data[i * 4 + 1] = on;
        data[i * 4 + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, state.read.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simW, simH, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    seed();

    var pending = []; // splats queued from pointer
    function queueSplat(e) {
      var r = canvas.getBoundingClientRect();
      pending.push({
        x: (e.clientX - r.left) / r.width,
        y: 1 - (e.clientY - r.top) / r.height
      });
    }
    if (!opts.preview) {
      canvas.style.cursor = "crosshair";
      canvas.addEventListener("pointerdown", function (e) {
        canvas.setPointerCapture(e.pointerId);
        queueSplat(e);
      });
      canvas.addEventListener("pointermove", function (e) {
        if (e.buttons) queueSplat(e);
      });
      canvas.addEventListener("dblclick", seed);
    }

    function runPass(p, target, setup) {
      gl.useProgram(p.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.read.tex);
      gl.uniform1i(p.u.u_state, 0);
      gl.uniform2f(p.u.u_size, simW, simH);
      if (setup) setup();
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, target ? simW : canvas.width, target ? simH : canvas.height);
      q.draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    var acc = 0, reseedTimer = 0;
    var stepInterval = opts.preview ? 1 / 13 : 1 / 22;

    var l = MiriGL.loop(function (dt) {
      MiriGL.resize(gl, canvas, opts.dprCap);

      while (pending.length) {
        var s = pending.shift();
        runPass(splatP, state.write.fbo, function () {
          gl.uniform2f(splatP.u.u_pos, s.x, s.y);
          gl.uniform1f(splatP.u.u_radius, 7.0);
          gl.uniform1f(splatP.u.u_seed, Math.random() * 100);
        });
        state.swap();
      }

      acc += dt;
      while (acc >= stepInterval) {
        acc -= stepInterval;
        runPass(stepP, state.write.fbo);
        state.swap();
      }

      if (opts.preview) {
        reseedTimer += dt;
        if (reseedTimer > 24) { reseedTimer = 0; seed(); }
      }

      runPass(drawP, null);
    });
    return l;
  });
})();
