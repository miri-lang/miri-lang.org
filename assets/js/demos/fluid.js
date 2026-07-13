/* Demo: Fluid simulation — Stam-style stable fluids, all passes on GPU */
(function () {
  "use strict";

  function fs(body) {
    return "#version 300 es\nprecision highp float;\nin vec2 v_uv;\nout vec4 o;\n" + body;
  }

  var ADVECT = fs([
    "uniform sampler2D u_vel;",
    "uniform sampler2D u_src;",
    "uniform vec2 u_texel;",
    "uniform float u_dt;",
    "uniform float u_diss;",
    "void main(){",
    "  vec2 vel = texture(u_vel, v_uv).xy;",
    "  vec2 back = v_uv - vel * u_dt * u_texel;",
    "  o = texture(u_src, back) * u_diss;",
    "}"
  ].join("\n"));

  var SPLAT = fs([
    "uniform sampler2D u_src;",
    "uniform vec2 u_pos;",
    "uniform vec3 u_val;",
    "uniform float u_radius;",
    "uniform float u_aspect;",
    "void main(){",
    "  vec2 d = v_uv - u_pos;",
    "  d.x *= u_aspect;",
    "  float g = exp(-dot(d, d) / u_radius);",
    "  vec3 base = texture(u_src, v_uv).xyz;",
    "  o = vec4(base + u_val * g, 1.0);",
    "}"
  ].join("\n"));

  var DIVERGENCE = fs([
    "uniform sampler2D u_vel;",
    "uniform vec2 u_texel;",
    "void main(){",
    "  float l = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).x;",
    "  float r = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).x;",
    "  float b = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).y;",
    "  float t = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).y;",
    "  o = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);",
    "}"
  ].join("\n"));

  var PRESSURE = fs([
    "uniform sampler2D u_pre;",
    "uniform sampler2D u_div;",
    "uniform vec2 u_texel;",
    "void main(){",
    "  float l = texture(u_pre, v_uv - vec2(u_texel.x, 0.0)).x;",
    "  float r = texture(u_pre, v_uv + vec2(u_texel.x, 0.0)).x;",
    "  float b = texture(u_pre, v_uv - vec2(0.0, u_texel.y)).x;",
    "  float t = texture(u_pre, v_uv + vec2(0.0, u_texel.y)).x;",
    "  float div = texture(u_div, v_uv).x;",
    "  o = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);",
    "}"
  ].join("\n"));

  var GRADIENT = fs([
    "uniform sampler2D u_pre;",
    "uniform sampler2D u_vel;",
    "uniform vec2 u_texel;",
    "void main(){",
    "  float l = texture(u_pre, v_uv - vec2(u_texel.x, 0.0)).x;",
    "  float r = texture(u_pre, v_uv + vec2(u_texel.x, 0.0)).x;",
    "  float b = texture(u_pre, v_uv - vec2(0.0, u_texel.y)).x;",
    "  float t = texture(u_pre, v_uv + vec2(0.0, u_texel.y)).x;",
    "  vec2 vel = texture(u_vel, v_uv).xy;",
    "  o = vec4(vel - 0.5 * vec2(r - l, t - b), 0.0, 1.0);",
    "}"
  ].join("\n"));

  var DISPLAY = fs([
    "uniform sampler2D u_dye;",
    "void main(){",
    "  vec3 c = texture(u_dye, v_uv).rgb;",
    "  vec3 bg = vec3(0.012, 0.02, 0.046);",
    "  c = pow(max(c, 0.0), vec3(0.85));",
    "  o = vec4(bg + c, 1.0);",
    "}"
  ].join("\n"));

  MiriDemos.register("fluid", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;
    if (!gl.getExtension("EXT_color_buffer_float")) return null;

    var progs = {
      advect: MiriGL.program(gl, MiriGL.QUAD_VS, ADVECT),
      splat: MiriGL.program(gl, MiriGL.QUAD_VS, SPLAT),
      div: MiriGL.program(gl, MiriGL.QUAD_VS, DIVERGENCE),
      pre: MiriGL.program(gl, MiriGL.QUAD_VS, PRESSURE),
      grad: MiriGL.program(gl, MiriGL.QUAD_VS, GRADIENT),
      show: MiriGL.program(gl, MiriGL.QUAD_VS, DISPLAY)
    };
    var q = MiriGL.quad(gl);

    var simRes = opts.preview ? 96 : 144;
    var dyeRes = opts.preview ? 256 : 512;
    var HF = gl.HALF_FLOAT;
    var vel = MiriGL.doubleFBO(gl, simRes, simRes, gl.RGBA16F, gl.RGBA, HF, gl.LINEAR);
    var dye = MiriGL.doubleFBO(gl, dyeRes, dyeRes, gl.RGBA16F, gl.RGBA, HF, gl.LINEAR);
    var div = MiriGL.makeFBO(gl, simRes, simRes, gl.RGBA16F, gl.RGBA, HF, gl.NEAREST);
    var pre = MiriGL.doubleFBO(gl, simRes, simRes, gl.RGBA16F, gl.RGBA, HF, gl.NEAREST);

    function bindTex(unit, tex) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      return unit;
    }
    function blit(target, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, w, h);
      q.draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    var pointer = { x: 0.5, y: 0.5, dx: 0, dy: 0, down: false, moved: false, hue: 0 };
    function onMove(e) {
      var r = canvas.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width;
      var y = 1 - (e.clientY - r.top) / r.height;
      pointer.dx = (x - pointer.x) * 600;
      pointer.dy = (y - pointer.y) * 600;
      pointer.x = x; pointer.y = y;
      pointer.moved = Math.abs(pointer.dx) + Math.abs(pointer.dy) > 0.5;
    }
    if (!opts.preview) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onMove);
    }

    function doSplat(x, y, dx, dy, color) {
      var aspect = canvas.width / Math.max(1, canvas.height);
      // velocity
      gl.useProgram(progs.splat.prog);
      gl.uniform1i(progs.splat.u.u_src, bindTex(0, vel.read.tex));
      gl.uniform2f(progs.splat.u.u_pos, x, y);
      gl.uniform3f(progs.splat.u.u_val, dx, dy, 0);
      gl.uniform1f(progs.splat.u.u_radius, 0.002);
      gl.uniform1f(progs.splat.u.u_aspect, aspect);
      blit(vel.write.fbo, simRes, simRes);
      vel.swap();
      // dye
      gl.uniform1i(progs.splat.u.u_src, bindTex(0, dye.read.tex));
      gl.uniform3f(progs.splat.u.u_val, color[0], color[1], color[2]);
      gl.uniform1f(progs.splat.u.u_radius, 0.0014);
      blit(dye.write.fbo, dyeRes, dyeRes);
      dye.swap();
    }

    var YELLOW = [0.5, 0.4, 0.08], BLUE = [0.1, 0.2, 0.55];
    var autoT = 0, idleT = 10;

    var l = MiriGL.loop(function (dt, t) {
      MiriGL.resize(gl, canvas, opts.dprCap);
      var texelV = [1 / simRes, 1 / simRes];

      // pointer splats
      if (pointer.moved) {
        pointer.moved = false;
        idleT = 0;
        var c = (Math.floor(t * 0.7) % 2 === 0) ? YELLOW : BLUE;
        doSplat(pointer.x, pointer.y, pointer.dx, pointer.dy, c);
      }
      idleT += dt;

      // ambient auto-splats (always in preview; when idle on full demo)
      autoT -= dt;
      if (autoT <= 0 && (opts.preview || idleT > 3)) {
        autoT = opts.preview ? 0.9 : 1.4;
        var a = t * 0.8 + Math.sin(t * 0.37) * 3.0;
        var x = 0.5 + 0.33 * Math.cos(a);
        var y = 0.5 + 0.33 * Math.sin(a * 1.3);
        var dx = -Math.sin(a) * 220, dy = Math.cos(a * 1.3) * 220;
        doSplat(x, y, dx, dy, Math.random() > 0.5 ? YELLOW : BLUE);
      }

      // advect velocity
      gl.useProgram(progs.advect.prog);
      gl.uniform1i(progs.advect.u.u_vel, bindTex(0, vel.read.tex));
      gl.uniform1i(progs.advect.u.u_src, bindTex(1, vel.read.tex));
      gl.uniform2f(progs.advect.u.u_texel, texelV[0], texelV[1]);
      gl.uniform1f(progs.advect.u.u_dt, dt);
      gl.uniform1f(progs.advect.u.u_diss, 0.995);
      blit(vel.write.fbo, simRes, simRes);
      vel.swap();

      // advect dye
      gl.uniform1i(progs.advect.u.u_vel, bindTex(0, vel.read.tex));
      gl.uniform1i(progs.advect.u.u_src, bindTex(1, dye.read.tex));
      gl.uniform1f(progs.advect.u.u_diss, 0.985);
      blit(dye.write.fbo, dyeRes, dyeRes);
      dye.swap();

      // divergence
      gl.useProgram(progs.div.prog);
      gl.uniform1i(progs.div.u.u_vel, bindTex(0, vel.read.tex));
      gl.uniform2f(progs.div.u.u_texel, texelV[0], texelV[1]);
      blit(div.fbo, simRes, simRes);

      // pressure solve
      gl.useProgram(progs.pre.prog);
      gl.uniform1i(progs.pre.u.u_div, bindTex(1, div.tex));
      gl.uniform2f(progs.pre.u.u_texel, texelV[0], texelV[1]);
      for (var i = 0; i < 18; i++) {
        gl.uniform1i(progs.pre.u.u_pre, bindTex(0, pre.read.tex));
        blit(pre.write.fbo, simRes, simRes);
        pre.swap();
      }

      // subtract gradient
      gl.useProgram(progs.grad.prog);
      gl.uniform1i(progs.grad.u.u_pre, bindTex(0, pre.read.tex));
      gl.uniform1i(progs.grad.u.u_vel, bindTex(1, vel.read.tex));
      gl.uniform2f(progs.grad.u.u_texel, texelV[0], texelV[1]);
      blit(vel.write.fbo, simRes, simRes);
      vel.swap();

      // display
      gl.useProgram(progs.show.prog);
      gl.uniform1i(progs.show.u.u_dye, bindTex(0, dye.read.tex));
      gl.viewport(0, 0, canvas.width, canvas.height);
      q.draw();
    });
    return l;
  });
})();
