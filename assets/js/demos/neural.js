/* Demo: Neural network — a 2-12-12-1 MLP trains live (gradient descent + momentum);
   a fragment kernel evaluates the network at EVERY pixel to paint the decision field.
   Weights travel to the GPU each frame as a 205-texel float texture. */
(function () {
  "use strict";

  var H = 12;                 // hidden width
  var NW = 24 + 12 + 144 + 12 + 12 + 1; // 205 params

  var FIELD_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 v_uv;",
    "out vec4 o;",
    "uniform sampler2D u_wt;",
    "uniform float u_aspect;",
    "uniform float u_time;",
    "const int H = 12;",
    "float W(int i){ return texelFetch(u_wt, ivec2(i, 0), 0).r; }",
    "void main(){",
    "  vec2 x = (v_uv - 0.5) * 2.0;",
    "  x.x *= u_aspect;",
    "  float h1[H];",
    "  for(int j = 0; j < H; j++)",
    "    h1[j] = tanh(W(j*2) * x.x + W(j*2+1) * x.y + W(24+j));",
    "  float h2[H];",
    "  for(int j = 0; j < H; j++){",
    "    float s = W(180+j);",
    "    for(int k = 0; k < H; k++) s += W(36 + j*H + k) * h1[k];",
    "    h2[j] = tanh(s);",
    "  }",
    "  float s = W(204);",
    "  for(int j = 0; j < H; j++) s += W(192+j) * h2[j];",
    "  float p = 1.0 / (1.0 + exp(-s));",

    "  vec3 navy = vec3(0.012, 0.02, 0.046);",
    "  vec3 blue = vec3(0.16, 0.31, 0.82);",
    "  vec3 yellow = vec3(1.0, 0.84, 0.24);",
    "  float conf = abs(p - 0.5) * 2.0;",
    "  vec3 side = (p < 0.5) ? blue : yellow;",
    "  vec3 col = navy + side * (0.10 + 0.60 * conf * conf);",
    // confidence iso-contours that flow outward from the boundary — makes
    // the field feel alive even when weights have nearly settled
    "  float bands = abs(fract(p * 9.0 - u_time * 0.25) - 0.5);",
    "  col += side * smoothstep(0.44, 0.5, bands) * 0.10;",
    // decision boundary: a bright, breathing seam at p = 0.5
    "  float edge = exp(-pow(abs(p - 0.5) / 0.035, 2.0));",
    "  float pulse = 0.72 + 0.28 * sin(u_time * 2.4);",
    "  col += vec3(0.90, 0.95, 1.0) * edge * (0.55 * pulse);",
    "  o = vec4(col, 1.0);",
    "}"
  ].join("\n");

  var PT_VS = [
    "#version 300 es",
    "precision highp float;",
    "layout(location=0) in vec2 a_pos;",
    "layout(location=1) in float a_cls;",
    "uniform float u_aspect;",
    "uniform float u_ps;",
    "out float v_cls;",
    "void main(){",
    "  v_cls = a_cls;",
    "  gl_Position = vec4(a_pos.x / u_aspect, a_pos.y, 0.0, 1.0);",
    "  gl_PointSize = u_ps;",
    "}"
  ].join("\n");

  var PT_FS = [
    "#version 300 es",
    "precision highp float;",
    "in float v_cls;",
    "out vec4 o;",
    "void main(){",
    "  vec2 d = gl_PointCoord - 0.5;",
    "  float r = length(d);",
    "  if(r > 0.5) discard;",
    "  vec3 blue = vec3(0.45, 0.62, 1.0);",
    "  vec3 yellow = vec3(1.0, 0.88, 0.4);",
    "  vec3 col = mix(blue, yellow, v_cls);",
    "  float core = 1.0 - smoothstep(0.28, 0.42, r);",
    "  vec3 rim = vec3(0.01, 0.02, 0.05);",
    "  o = vec4(mix(rim, col, core), 1.0 - smoothstep(0.42, 0.5, r));",
    "}"
  ].join("\n");

  // ---------- datasets ----------
  function genData(kind) {
    var pts = [];
    var i, n, t, r, th, a;
    if (kind === "spiral") {
      for (var c = 0; c < 2; c++) {
        for (i = 0, n = 110; i < n; i++) {
          t = i / n;
          r = 0.13 + 0.74 * t;
          th = t * 4.4 + c * Math.PI;
          pts.push({
            x: r * Math.cos(th) + (Math.random() - 0.5) * 0.07,
            y: r * Math.sin(th) + (Math.random() - 0.5) * 0.07,
            y0: c
          });
        }
      }
    } else if (kind === "rings") {
      for (i = 0; i < 100; i++) {
        r = Math.sqrt(Math.random()) * 0.34;
        a = Math.random() * Math.PI * 2;
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), y0: 1 });
      }
      for (i = 0; i < 120; i++) {
        r = 0.58 + Math.random() * 0.27;
        a = Math.random() * Math.PI * 2;
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), y0: 0 });
      }
    } else { // xor
      for (i = 0; i < 220; i++) {
        var px = (Math.random() * 2 - 1) * 0.85;
        var py = (Math.random() * 2 - 1) * 0.85;
        if (Math.abs(px) < 0.06 || Math.abs(py) < 0.06) { i--; continue; }
        pts.push({ x: px, y: py, y0: px * py > 0 ? 1 : 0 });
      }
    }
    return pts;
  }

  // ---------- MLP (JS training, full batch + momentum) ----------
  function makeNet() {
    function rnd(n, scale) {
      var a = new Float32Array(n);
      for (var i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * scale;
      return a;
    }
    return {
      w1: rnd(24, 0.65), b1: new Float32Array(H),
      w2: rnd(144, 0.5), b2: new Float32Array(H),
      w3: rnd(12, 0.68), b3: new Float32Array(1),
      m: { w1: new Float32Array(24), b1: new Float32Array(H),
           w2: new Float32Array(144), b2: new Float32Array(H),
           w3: new Float32Array(12), b3: new Float32Array(1) }
    };
  }

  function trainStep(net, data, lr) {
    var gw1 = new Float32Array(24), gb1 = new Float32Array(H);
    var gw2 = new Float32Array(144), gb2 = new Float32Array(H);
    var gw3 = new Float32Array(12), gb3 = 0;
    var h1 = new Float32Array(H), h2 = new Float32Array(H);
    var d1 = new Float32Array(H), d2 = new Float32Array(H);
    var loss = 0, n = data.length;
    var j, k, s;

    for (var i = 0; i < n; i++) {
      var pt = data[i];
      for (j = 0; j < H; j++)
        h1[j] = Math.tanh(net.w1[j * 2] * pt.x + net.w1[j * 2 + 1] * pt.y + net.b1[j]);
      for (j = 0; j < H; j++) {
        s = net.b2[j];
        for (k = 0; k < H; k++) s += net.w2[j * H + k] * h1[k];
        h2[j] = Math.tanh(s);
      }
      s = net.b3[0];
      for (j = 0; j < H; j++) s += net.w3[j] * h2[j];
      var p = 1 / (1 + Math.exp(-s));
      loss += pt.y0 ? -Math.log(p + 1e-7) : -Math.log(1 - p + 1e-7);

      var ds = p - pt.y0;
      gb3 += ds;
      for (j = 0; j < H; j++) {
        gw3[j] += ds * h2[j];
        d2[j] = ds * net.w3[j] * (1 - h2[j] * h2[j]);
      }
      for (j = 0; j < H; j++) {
        gb2[j] += d2[j];
        for (k = 0; k < H; k++) gw2[j * H + k] += d2[j] * h1[k];
      }
      for (k = 0; k < H; k++) {
        s = 0;
        for (j = 0; j < H; j++) s += d2[j] * net.w2[j * H + k];
        d1[k] = s * (1 - h1[k] * h1[k]);
      }
      for (k = 0; k < H; k++) {
        gb1[k] += d1[k];
        gw1[k * 2] += d1[k] * pt.x;
        gw1[k * 2 + 1] += d1[k] * pt.y;
      }
    }

    var mu = 0.9, sc = lr / n;
    function apply(w, g, m) {
      for (var i2 = 0; i2 < w.length; i2++) {
        m[i2] = mu * m[i2] - sc * g[i2];
        w[i2] += m[i2];
      }
    }
    apply(net.w1, gw1, net.m.w1); apply(net.b1, gb1, net.m.b1);
    apply(net.w2, gw2, net.m.w2); apply(net.b2, gb2, net.m.b2);
    apply(net.w3, gw3, net.m.w3);
    net.m.b3[0] = mu * net.m.b3[0] - sc * gb3;
    net.b3[0] += net.m.b3[0];
    return loss / n;
  }

  function packWeights(net, out) {
    out.set(net.w1, 0);
    out.set(net.b1, 24);
    out.set(net.w2, 36);
    out.set(net.b2, 180);
    out.set(net.w3, 192);
    out[204] = net.b3[0];
  }

  // ---------- demo ----------
  MiriDemos.register("neural", function (canvas, opts) {
    var gl = MiriGL.createContext(canvas);
    if (!gl) return null;

    var fieldP = MiriGL.program(gl, MiriGL.QUAD_VS, FIELD_FS);
    var ptP = MiriGL.program(gl, PT_VS, PT_FS);
    var q = MiriGL.quad(gl);

    // weights texture: 205 x 1, R32F, sampled with texelFetch
    var wtTex = MiriGL.makeTexture(gl, NW, 1, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST);
    var wtBuf = new Float32Array(NW);

    // point sprites
    var ptVAO = gl.createVertexArray();
    var ptBuf = gl.createBuffer();
    gl.bindVertexArray(ptVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);

    var net, data, epoch, loss = 1, dataset = "spiral";
    var datasetOrder = ["spiral", "rings", "xor"];

    function uploadPoints() {
      var arr = new Float32Array(data.length * 3);
      for (var i = 0; i < data.length; i++) {
        arr[i * 3] = data[i].x;
        arr[i * 3 + 1] = data[i].y;
        arr[i * 3 + 2] = data[i].y0;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    }
    function reset(kind) {
      dataset = kind || dataset;
      net = makeNet();
      data = genData(dataset);
      epoch = 0;
      uploadPoints();
      syncChips();
    }

    // optional page hooks (present on the playground page only)
    var root = canvas.closest("[data-demo]");
    var statsEl = root ? root.querySelector(".nn-stats") : null;
    var chips = root ? root.querySelectorAll(".nn-chip") : [];
    function syncChips() {
      for (var i = 0; i < chips.length; i++)
        chips[i].classList.toggle("active", chips[i].getAttribute("data-set") === dataset);
    }
    for (var ci = 0; ci < chips.length; ci++) {
      (function (chip) {
        chip.addEventListener("click", function (e) {
          e.preventDefault();
          reset(chip.getAttribute("data-set"));
        });
      })(chips[ci]);
    }
    if (!opts.preview) {
      canvas.style.cursor = "pointer";
      canvas.addEventListener("click", function () { reset(); });
    }

    reset("spiral");

    var statTick = 0, cycleT = 0, settleT = 0;
    function nextSet() {
      reset(datasetOrder[(datasetOrder.indexOf(dataset) + 1) % datasetOrder.length]);
    }

    var l = MiriGL.loop(function (dt, t) {
      MiriGL.resize(gl, canvas, opts.dprCap);
      var aspect = canvas.width / Math.max(1, canvas.height);

      // train (CPU is the "host"; field evaluation below is the GPU kernel)
      var steps = opts.preview ? 2 : 3;
      for (var i = 0; i < steps; i++) loss = trainStep(net, data, 0.25);
      epoch += steps;

      if (opts.preview) {
        cycleT += dt;
        if (cycleT > 16) { cycleT = 0; nextSet(); }
      } else {
        // once the boundary has settled, hold it briefly then re-form on the
        // next dataset — keeps the field visibly learning, not frozen
        if (loss < 0.14) settleT += dt; else settleT = 0;
        if (settleT > 4.5) { settleT = 0; nextSet(); }
      }

      // upload weights
      packWeights(net, wtBuf);
      gl.bindTexture(gl.TEXTURE_2D, wtTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NW, 1, gl.RED, gl.FLOAT, wtBuf);

      // decision field
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(fieldP.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, wtTex);
      gl.uniform1i(fieldP.u.u_wt, 0);
      gl.uniform1f(fieldP.u.u_aspect, aspect);
      gl.uniform1f(fieldP.u.u_time, t);
      q.draw();

      // data points
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(ptP.prog);
      gl.uniform1f(ptP.u.u_aspect, aspect);
      gl.uniform1f(ptP.u.u_ps, opts.preview ? 5.0 : Math.max(6.0, canvas.width / 140));
      gl.bindVertexArray(ptVAO);
      gl.drawArrays(gl.POINTS, 0, data.length);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // stats readout
      if (statsEl && ++statTick % 10 === 0) {
        statsEl.innerHTML = "epoch <b>" + epoch + "</b> · loss <b>" + loss.toFixed(3) + "</b>";
      }
    });
    return l;
  });
})();
