/*
 * An interactive 3D map of every public project and every upstream repository engaged.
 *
 * Hand-written WebGL: no Three.js, no library, no CDN. The whole renderer is a few hundred
 * lines because the scene is a point cloud with lines, and pulling in a 600 KB engine to
 * draw 44 points would cost more than it explains.
 *
 * Everything it draws is real: node position is deterministic from the project list, size is
 * the square root of star count, colour is the repository's primary language, and the outer
 * shell is the upstream repositories where pull requests were submitted.
 *
 * The page is fully readable without this file. It enhances; it is never load-bearing.
 */
(() => {
  'use strict';

  const host = document.getElementById('constellation');
  if (!host) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  // The fragment shaders output premultiplied colour (rgb * a, a) and blend with
  // ONE / ONE_MINUS_SRC_ALPHA. Declaring premultipliedAlpha:false here would make the
  // compositor divide by alpha again and wash the whole field out to white.
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) { host.classList.add('unsupported'); return; }

  const label = document.getElementById('constellation-label');
  const labelName = label && label.querySelector('.cl-name');
  const labelMeta = label && label.querySelector('.cl-meta');

  // ---------- shaders ----------

  const VERT_POINTS = `
    attribute vec3 aPos;
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aHot;
    uniform mat4 uMVP;
    uniform float uScale;
    varying vec3 vColor;
    varying float vDepth;
    varying float vHot;
    void main() {
      vec4 clip = uMVP * vec4(aPos, 1.0);
      gl_Position = clip;
      // Perspective-correct sizing: nearer nodes read as nearer.
      gl_PointSize = aSize * uScale / max(clip.w, 0.35);
      vColor = aColor;
      vDepth = clamp(clip.w, 0.0, 6.0);
      vHot = aHot;
    }`;

  const FRAG_POINTS = `
    precision mediump float;
    varying vec3 vColor;
    varying float vDepth;
    varying float vHot;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = length(d) * 2.0;
      if (r > 1.0) discard;
      // Soft core plus a wide falloff halo, so points glow instead of looking like discs.
      float core = smoothstep(1.0, 0.0, r);
      float glow = pow(core, 2.0);
      float halo = pow(smoothstep(1.0, 0.30, r), 1.8) * 0.30;
      // Gentle depth attenuation only: the cluster is barely two units deep, so a steep
      // fog curve made every far node invisible rather than merely recessed.
      float fog = clamp(1.35 - vDepth * 0.13, 0.35, 1.0);
      vec3 c = mix(vColor, vec3(1.0), glow * 0.40 + vHot * 0.35);
      // Clamp before writing: additive blending over many overlapping halos otherwise
      // accumulates past white and erases the text sitting on top of the canvas.
      float a = clamp((glow * 1.6 + halo) * fog * (1.0 + vHot * 0.5), 0.0, 0.98);
      gl_FragColor = vec4(c * a, a);
    }`;

  const VERT_LINES = `
    attribute vec3 aPos;
    attribute float aFade;
    uniform mat4 uMVP;
    varying float vFade;
    varying float vDepth;
    void main() {
      vec4 clip = uMVP * vec4(aPos, 1.0);
      gl_Position = clip;
      vFade = aFade;
      vDepth = clamp(clip.w, 0.0, 6.0);
    }`;

  const FRAG_LINES = `
    precision mediump float;
    uniform vec3 uColor;
    varying float vFade;
    varying float vDepth;
    void main() {
      float fog = clamp(1.3 - vDepth * 0.14, 0.2, 1.0);
      float a = vFade * fog * 0.16;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    }
    return s;
  }

  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    }
    return p;
  }

  let pointProg, lineProg;
  try {
    pointProg = program(VERT_POINTS, FRAG_POINTS);
    lineProg = program(VERT_LINES, FRAG_LINES);
  } catch (err) {
    // A driver that cannot compile these shaders gets the static page, not a broken canvas.
    host.classList.add('unsupported');
    return;
  }

  // ---------- matrices (column-major, as WebGL expects) ----------

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  function multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                         a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function orbit(yaw, pitch, distance, offsetX) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // rotation about Y then X, then translate away from the origin
    const rot = [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1];
    // offsetX slides the cluster sideways in view space. The hero keeps its copy on the
    // left, so on a wide screen the field is pushed right to sit in the clear area rather
    // than behind the text.
    const trans = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offsetX, 0, -distance, 1];
    return multiply(trans, rot);
  }

  // ---------- state ----------

  const state = {
    nodes: [], edges: [],
    yaw: 0.6, pitch: -0.22,
    targetYaw: 0.6, targetPitch: -0.22,
    distance: 5.1,
    hover: -1,
    pointer: { x: 0, y: 0, inside: false },
    dragging: false, lastX: 0, lastY: 0, dragged: false,
    projected: [],
    running: false,
  };

  let buffers = null;

  function buildBuffers() {
    const n = state.nodes.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const hot = new Float32Array(n);
    state.nodes.forEach((node, i) => {
      pos[i * 3] = node.p[0]; pos[i * 3 + 1] = node.p[1]; pos[i * 3 + 2] = node.p[2];
      col[i * 3] = node.color[0]; col[i * 3 + 1] = node.color[1]; col[i * 3 + 2] = node.color[2];
      size[i] = node.w * 16.0;
      hot[i] = 0;
    });

    const lp = new Float32Array(state.edges.length * 6);
    const lf = new Float32Array(state.edges.length * 2);
    state.edges.forEach((e, i) => {
      const a = state.nodes[e[0]], b = state.nodes[e[1]];
      if (!a || !b) return;
      lp.set(a.p, i * 6); lp.set(b.p, i * 6 + 3);
      lf[i * 2] = 1; lf[i * 2 + 1] = 1;
    });

    const mk = (data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    };
    buffers = {
      pos: mk(pos), col: mk(col), size: mk(size),
      hot: mk(hot), hotData: hot,
      linePos: mk(lp), lineFade: mk(lf), lineCount: state.edges.length * 2,
      count: n,
    };
  }

  function bindAttrib(prog, name, buffer, components) {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, components, gl.FLOAT, false, 0, 0);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    return true;
  }

  function project(mvp, p, w, h) {
    const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const wc = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (wc <= 0.01) return null;
    return { x: (x / wc * 0.5 + 0.5) * w, y: (1 - (y / wc * 0.5 + 0.5)) * h, w: wc };
  }

  function updateHover(mvp, w, h) {
    if (!state.pointer.inside) { setHover(-1); return; }
    let best = -1, bestDist = 26 * 26;
    state.projected.length = 0;
    for (let i = 0; i < state.nodes.length; i++) {
      const sp = project(mvp, state.nodes[i].p, w, h);
      state.projected[i] = sp;
      if (!sp) continue;
      const dx = sp.x - state.pointer.x, dy = sp.y - state.pointer.y;
      const d = dx * dx + dy * dy;
      // Bias toward nearer nodes so a distant point behind the cursor cannot steal focus.
      const weighted = d * (0.65 + sp.w * 0.14);
      if (weighted < bestDist) { bestDist = weighted; best = i; }
    }
    setHover(best);
  }

  function setHover(index) {
    if (state.hover === index) return;
    state.hover = index;
    const hot = buffers.hotData;
    hot.fill(0);
    if (index >= 0) {
      hot[index] = 1;
      for (const e of state.edges) {
        if (e[0] === index) hot[e[1]] = Math.max(hot[e[1]], 0.5);
        else if (e[1] === index) hot[e[0]] = Math.max(hot[e[0]], 0.5);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hot);
    gl.bufferData(gl.ARRAY_BUFFER, hot, gl.DYNAMIC_DRAW);

    if (!label) return;
    if (index < 0) { label.hidden = true; canvas.style.cursor = 'grab'; return; }
    const node = state.nodes[index];
    labelName.textContent = node.id;
    labelMeta.textContent = node.kind === 'repo'
      ? (node.stars ? `${node.lang} · ${node.stars} stars` : node.lang)
      : 'upstream · pull request submitted';
    label.hidden = false;
    canvas.style.cursor = 'pointer';
  }

  function positionLabel() {
    if (!label || label.hidden || state.hover < 0) return;
    const sp = state.projected[state.hover];
    if (!sp) return;
    label.style.transform = `translate(${Math.round(sp.x)}px, ${Math.round(sp.y)}px)`;
  }

  let last = 0;
  function frame(now) {
    if (!state.running) return;
    const dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;

    if (!resize()) { requestAnimationFrame(frame); return; }
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    if (!state.dragging && !reduceMotion) state.targetYaw += dt * 0.075;
    // Ease toward the target so dragging feels weighted rather than rigid.
    state.yaw += (state.targetYaw - state.yaw) * Math.min(1, dt * 6);
    state.pitch += (state.targetPitch - state.pitch) * Math.min(1, dt * 6);

    const aspect = w / h;
    const offsetX = aspect > 1.15 ? 1.55 : 0;
    const mvp = multiply(perspective(0.85, aspect, 0.1, 60), orbit(state.yaw, state.pitch, state.distance, offsetX));

    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uMVP'), false, new Float32Array(mvp));
    gl.uniform3f(gl.getUniformLocation(lineProg, 'uColor'), 0.35, 0.85, 0.78);
    bindAttrib(lineProg, 'aPos', buffers.linePos, 3);
    bindAttrib(lineProg, 'aFade', buffers.lineFade, 1);
    gl.drawArrays(gl.LINES, 0, buffers.lineCount);

    gl.useProgram(pointProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(pointProg, 'uMVP'), false, new Float32Array(mvp));
    gl.uniform1f(gl.getUniformLocation(pointProg, 'uScale'), Math.min(h / 700, 2.2));
    bindAttrib(pointProg, 'aPos', buffers.pos, 3);
    bindAttrib(pointProg, 'aColor', buffers.col, 3);
    bindAttrib(pointProg, 'aSize', buffers.size, 1);
    bindAttrib(pointProg, 'aHot', buffers.hot, 1);
    gl.drawArrays(gl.POINTS, 0, buffers.count);

    const dpr = canvas.width / host.clientWidth;
    updateHover(mvp, host.clientWidth * dpr, host.clientHeight * dpr);
    if (state.hover >= 0 && state.projected[state.hover]) {
      const sp = state.projected[state.hover];
      label.style.transform = `translate(${Math.round(sp.x / dpr)}px, ${Math.round(sp.y / dpr)}px)`;
    }

    requestAnimationFrame(frame);
  }

  // ---------- interaction ----------

  function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    state.pointer.x = (event.clientX - rect.left) * dpr;
    state.pointer.y = (event.clientY - rect.top) * dpr;
  }

  canvas.addEventListener('pointerenter', () => { state.pointer.inside = true; });
  canvas.addEventListener('pointerleave', () => { state.pointer.inside = false; setHover(-1); });
  canvas.addEventListener('pointermove', (e) => {
    pointerPos(e);
    if (state.dragging) {
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.dragged = true;
      state.targetYaw += dx * 0.006;
      state.targetPitch = Math.max(-1.15, Math.min(1.15, state.targetPitch + dy * 0.005));
      state.lastX = e.clientX; state.lastY = e.clientY;
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    state.dragging = true; state.dragged = false;
    state.lastX = e.clientX; state.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointerup', (e) => {
    state.dragging = false;
    canvas.style.cursor = state.hover >= 0 ? 'pointer' : 'grab';
    if (!state.dragged && state.hover >= 0) {
      const node = state.nodes[state.hover];
      const target = document.getElementById('p-' + node.id) || document.getElementById('card-' + node.id);
      if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      else window.open(node.url, '_blank', 'noopener');
    }
  });

  // ---------- boot ----------

  fetch('data/constellation.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('constellation data unavailable')))
    .then(data => {
      state.nodes = data.nodes;
      state.edges = data.edges;
      buildBuffers();
      host.classList.add('ready');
      canvas.style.cursor = 'grab';

      // Only run while the canvas is on screen: an off-screen animation loop is wasted battery.
      const io = new IntersectionObserver((entries) => {
        const visible = entries.some(e => e.isIntersecting);
        if (visible && !state.running) { state.running = true; last = performance.now(); requestAnimationFrame(frame); }
        else if (!visible) state.running = false;
      }, { threshold: 0.01 });
      io.observe(host);
    })
    .catch(() => { host.classList.add('unsupported'); });
})();
