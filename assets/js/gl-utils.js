/* MiriGL — WebGL2 helpers for the hero shader.
   The GPU demos are compiled Miri bundles and use miri-gpu.js instead. */
(function () {
  "use strict";

  var QUAD_VS = [
    "#version 300 es",
    "layout(location=0) in vec2 a_pos;",
    "out vec2 v_uv;",
    "void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }"
  ].join("\n");

  function createContext(canvas, opts) {
    var gl = canvas.getContext("webgl2", Object.assign({
      antialias: false, depth: false, stencil: false,
      alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance"
    }, opts || {}));
    return gl;
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("Shader error:\n" + gl.getShaderInfoLog(sh) + "\n--- source ---\n" + src);
      throw new Error("shader compile failed");
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error("Link error: " + gl.getProgramInfoLog(p));
      throw new Error("program link failed");
    }
    var uniforms = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u: uniforms };
  }

  function quad(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return {
      draw: function () {
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
      }
    };
  }

  function resize(gl, canvas, dprCap) {
    var dpr = Math.min(window.devicePixelRatio || 1, dprCap || 2);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      return true;
    }
    return false;
  }

  function loop(fn) {
    var raf = 0, running = false, last = 0;
    function frame(t) {
      if (!running) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      fn(dt, t / 1000);
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () {
        if (running) return;
        running = true; last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      stop: function () { running = false; cancelAnimationFrame(raf); }
    };
  }

  window.MiriGL = {
    QUAD_VS: QUAD_VS,
    createContext: createContext,
    program: program,
    quad: quad,
    resize: resize,
    loop: loop
  };
})();
