/* MiriGL — shared WebGL2 helpers + demo registry/mounting */
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

  function makeTexture(gl, w, h, internalFormat, format, type, filter, data) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data || null);
    return t;
  }

  function makeFBO(gl, w, h, internalFormat, format, type, filter) {
    var tex = makeTexture(gl, w, h, internalFormat, format, type, filter);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo: fbo, tex: tex, w: w, h: h };
  }

  function doubleFBO(gl, w, h, internalFormat, format, type, filter) {
    var a = makeFBO(gl, w, h, internalFormat, format, type, filter);
    var b = makeFBO(gl, w, h, internalFormat, format, type, filter);
    return {
      get read() { return a; },
      get write() { return b; },
      swap: function () { var t = a; a = b; b = t; },
      w: w, h: h
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

  // ---------- demo registry ----------
  var registry = {};

  function register(name, factory) { registry[name] = factory; }

  function mount(el) {
    var name = el.getAttribute("data-demo");
    var factory = registry[name];
    var frame = el.querySelector(".demo-canvas-frame") || el;
    var fallback = frame.querySelector(".gl-fallback");
    if (!factory) return;

    var canvas = document.createElement("canvas");
    frame.insertBefore(canvas, frame.firstChild);

    var opts = {
      preview: el.hasAttribute("data-preview"),
      dprCap: el.hasAttribute("data-preview") ? 1 : 2
    };

    var instance = null, failed = false, inView = true;

    function ensure() {
      if (instance || failed) return;
      try {
        instance = factory(canvas, opts);
        if (!instance) throw new Error("no gl");
      } catch (e) {
        failed = true;
        console.warn("Demo '" + name + "' unavailable:", e.message);
        if (fallback) fallback.classList.add("show");
        return;
      }
    }

    if (!("IntersectionObserver" in window)) {
      ensure(); if (instance) instance.start();
      return;
    }
    var delivered = false;
    var io = new IntersectionObserver(function (entries) {
      delivered = true;
      entries.forEach(function (en) {
        inView = en.isIntersecting;
        if (en.isIntersecting) {
          ensure();
          if (instance) instance.start();
        } else if (instance) {
          instance.stop();
        }
      });
    }, { rootMargin: "60px" });
    io.observe(el);
    // Fallback: if the observer never delivers, start the demo anyway —
    // IO is an optimization (pause offscreen), not a gate.
    setTimeout(function () {
      if (delivered) return;
      ensure();
      if (instance) instance.start();
    }, 700);

    document.addEventListener("visibilitychange", function () {
      if (!instance) return;
      if (document.hidden) instance.stop();
      else if (inView) instance.start();
    });
  }

  function mountAll() {
    var els = document.querySelectorAll("[data-demo]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
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
    makeTexture: makeTexture,
    makeFBO: makeFBO,
    doubleFBO: doubleFBO,
    resize: resize,
    loop: loop
  };
  window.MiriDemos = { register: register, mountAll: mountAll };

  document.addEventListener("DOMContentLoaded", mountAll);
})();
