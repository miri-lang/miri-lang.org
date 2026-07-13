/* Demo: N-body flow field — particle positions computed in a ping-pong texture */
(function () {
  "use strict";

  var UPDATE_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform sampler2D u_pos;",
    "uniform float u_dt;",
    "uniform float u_t;",
    "uniform vec2 u_mouse;",
    "uniform float u_mouseOn;",
    "uniform float u_aspect;",

    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),",
    "             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);",
    "}",
    "vec2 curl(vec2 p){",
    "  float e = 0.04;",
    "  float n1 = noise(p + vec2(0.0, e));",
    "  float n2 = noise(p - vec2(0.0, e));",
    "  float n3 = noise(p + vec2(e, 0.0));",
    "  float n4 = noise(p - vec2(e, 0.0));",
    "  return vec2(n1 - n2, n4 - n3) / (2.0 * e);",
    "}",

    "void main(){",
    "  vec4 P = texture(u_pos, v_uv);",
    "  vec2 pos = P.xy;",
    "  float age = P.z;",
    "  float seed = P.w;",
    "  float life = 4.0 + seed * 6.0;",

    "  vec2 sp = pos * vec2(u_aspect, 1.0);",
    "  vec2 vel = curl(sp * 1.7 + vec2(u_t * 0.12, -u_t * 0.07)) * 0.16;",
    "  vel += curl(sp * 0.5 - vec2(u_t * 0.05)) * 0.10;",

    "  if(u_mouseOn > 0.5){",
    "    vec2 d = (u_mouse - pos) * vec2(u_aspect, 1.0);",
    "    float r = length(d) + 1e-4;",
    "    vec2 dir = d / r;",
    "    vec2 tang = vec2(-dir.y, dir.x);",
    "    float g = exp(-r * 3.2);",
    "    vel += (dir * 0.45 + tang * 0.85) * g;",
    "  }",

    "  pos += vel * u_dt;",
    "  age += u_dt;",

    "  if(age > life || abs(pos.x) > 1.05 || abs(pos.y) > 1.05){",
    "    pos = vec2(hash(v_uv + u_t), hash(v_uv * 7.31 - u_t)) * 2.0 - 1.0;",
    "    age = 0.0;",
    "  }",
    "  o = vec4(pos, age, seed);",
    "}"
  ].join("\n");

  var POINT_VS = [
    "#version 300 es",
    "precision highp float;",
    "uniform sampler2D u_pos;",
    "uniform float u_texSize;",
    "uniform float u_pt;",
    "out float v_age;",
    "out float v_seed;",
    "void main(){",
    "  float fi = float(gl_VertexID);",
    "  vec2 uv = (vec2(mod(fi, u_texSize), floor(fi / u_texSize)) + 0.5) / u_texSize;",
    "  vec4 P = texture(u_pos, uv);",
    "  v_age = P.z;",
    "  v_seed = P.w;",
    "  gl_Position = vec4(P.xy, 0.0, 1.0);",
    "  gl_PointSize = u_pt;",
    "}"
  ].join("\n");

  var POINT_FS = [
    "#version 300 es",
    "precision highp float;",
    "in float v_age;",
    "in float v_seed;",
    "out vec4 o;",
    "void main(){",
    "  float fade = smoothstep(0.0, 0.6, v_age) * 0.85 + 0.15;",
    "  vec3 blue = vec3(0.22, 0.42, 1.0);",
    "  vec3 yellow = vec3(1.0, 0.82, 0.25);",
    "  vec3 col = mix(blue, yellow, step(0.86, v_seed));",
    "  o = vec4(col * fade * 0.5, 1.0);",
    "}"
  ].join("\n");

  var FADE_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform float u_fade;",
    "void main(){ o = vec4(vec3(0.012, 0.02, 0.046), u_fade); }"
  ].join("\n");

  MiriDemos.register("particles", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas, { preserveDrawingBuffer: true });
    if (!gl) return null;
    if (!gl.getExtension("EXT_color_buffer_float")) return null;

    var texSize = opts.preview ? 128 : 384; // 16k / 147k particles
    var count = texSize * texSize;

    var updateP = MiriGL.program(gl, MiriGL.QUAD_VS, UPDATE_FS);
    var pointP = MiriGL.program(gl, POINT_VS, POINT_FS);
    var fadeP = MiriGL.program(gl, MiriGL.QUAD_VS, FADE_FS);
    var q = MiriGL.quad(gl);

    // seed positions
    var init = new Float32Array(count * 4);
    for (var i = 0; i < count; i++) {
      init[i * 4] = Math.random() * 2 - 1;
      init[i * 4 + 1] = Math.random() * 2 - 1;
      init[i * 4 + 2] = Math.random() * 6;
      init[i * 4 + 3] = Math.random();
    }
    var pos = MiriGL.doubleFBO(gl, texSize, texSize, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, pos.read.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texSize, texSize, gl.RGBA, gl.FLOAT, init);

    var emptyVAO = gl.createVertexArray();

    var mouse = [0, 0], mouseOn = 0;
    if (!opts.preview) {
      canvas.addEventListener("pointermove", function (e) {
        var r = canvas.getBoundingClientRect();
        mouse[0] = ((e.clientX - r.left) / r.width) * 2 - 1;
        mouse[1] = -(((e.clientY - r.top) / r.height) * 2 - 1);
        mouseOn = 1;
      });
      canvas.addEventListener("pointerleave", function () { mouseOn = 0; });
    }

    var cleared = false;

    var l = MiriGL.loop(function (dt, t) {
      var resized = MiriGL.resize(gl, canvas, opts.dprCap);
      var aspect = canvas.width / Math.max(1, canvas.height);

      // update positions
      gl.useProgram(updateP.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pos.read.tex);
      gl.uniform1i(updateP.u.u_pos, 0);
      gl.uniform1f(updateP.u.u_dt, dt);
      gl.uniform1f(updateP.u.u_t, t);
      gl.uniform2f(updateP.u.u_mouse, mouse[0], mouse[1]);
      gl.uniform1f(updateP.u.u_mouseOn, mouseOn);
      gl.uniform1f(updateP.u.u_aspect, aspect);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pos.write.fbo);
      gl.viewport(0, 0, texSize, texSize);
      q.draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      pos.swap();

      // draw: fade previous frame, then additive points
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!cleared || resized) {
        gl.clearColor(0.012, 0.02, 0.046, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        cleared = true;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(fadeP.prog);
      gl.uniform1f(fadeP.u.u_fade, 0.085);
      q.draw();

      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pointP.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pos.read.tex);
      gl.uniform1i(pointP.u.u_pos, 0);
      gl.uniform1f(pointP.u.u_texSize, texSize);
      gl.uniform1f(pointP.u.u_pt, opts.preview ? 1.0 : Math.max(1.0, canvas.width / 900));
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    });
    return l;
  });
})();
