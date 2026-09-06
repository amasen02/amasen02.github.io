/*
 * Motion layer. Strictly additive: nothing here is required to read the page.
 *
 * Three effects, each cheap and each disabled under prefers-reduced-motion:
 *   1. Scroll reveals, driven by IntersectionObserver rather than scroll handlers.
 *   2. A pointer-tracked glow on cards, written to CSS custom properties so the paint
 *      work stays in the compositor.
 *   3. The concurrency proof: an animated retelling of the twenty-five parallel invoice
 *      allocators from freshcart-backend, because the claim is more convincing moving.
 */
(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // ---------- 1. scroll reveals ----------

  const revealables = document.querySelectorAll('.lead, .card, .theme, .block, .oss > *');
  if (reduce || !('IntersectionObserver' in window)) {
    revealables.forEach(el => el.classList.add('shown'));
  } else {
    revealables.forEach(el => el.classList.add('reveal'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('shown');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    revealables.forEach(el => io.observe(el));
  }

  // ---------- 2. pointer glow ----------

  if (!reduce && window.matchMedia('(hover: hover)').matches) {
    const cards = document.querySelectorAll('.lead, .card');
    cards.forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(2) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(2) + '%');
        card.classList.add('lit');
      });
      card.addEventListener('pointerleave', () => card.classList.remove('lit'));
    });
  }

  // ---------- 3. the concurrency proof ----------

  const proof = document.getElementById('proof');
  if (!proof) return;
  const canvas = proof.querySelector('canvas');
  const status = proof.querySelector('.proof-status');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const RUNNERS = 25;

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = proof.clientWidth, h = 260;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    // Reassigning width/height clears the canvas and reallocates its backing store, so only
    // touch it when the box has actually changed.
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  // Each runner races for a number. The point of the animation is the result: the awarded
  // set is exactly 1..25, with no gaps and no repeats, which is what the real test asserts.
  function makeRunners() {
    const order = Array.from({ length: RUNNERS }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order.map((lane, idx) => ({
      lane,
      awarded: idx + 1,       // the invoice number this racer ends up with
      delay: Math.random() * 0.42,
      speed: 0.9 + Math.random() * 0.8,
      progress: 0,
      settled: false,
    }));
  }

  const HOLD_MS = 2200;
  let runners = makeRunners();
  let started = 0;
  let raf = 0;
  let holdTimer = 0;
  let paused = false;
  let visible = false;

  function draw(now) {
    const { w, h } = sizeCanvas();
    const t = (now - started) / 1000;
    ctx.clearRect(0, 0, w, h);

    const padX = 14;
    const trackW = w - padX * 2;
    const laneH = h / RUNNERS;
    let settledCount = 0;

    for (const r of runners) {
      const local = Math.max(0, t - r.delay);
      r.progress = Math.min(1, local * r.speed * 1.15);
      if (r.progress >= 1) { r.settled = true; settledCount++; }

      const y = laneH * (r.lane + 0.5);
      const x = padX + trackW * r.progress;

      ctx.strokeStyle = 'rgba(90, 214, 192, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + trackW, y); ctx.stroke();

      const grad = ctx.createLinearGradient(padX, 0, x, 0);
      grad.addColorStop(0, 'rgba(90, 214, 192, 0)');
      grad.addColorStop(1, r.settled ? 'rgba(243, 182, 100, 0.85)' : 'rgba(90, 214, 192, 0.75)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(x, y); ctx.stroke();

      ctx.fillStyle = r.settled ? '#f3b664' : '#5ad6c0';
      ctx.beginPath(); ctx.arc(x, y, r.settled ? 2.6 : 2.0, 0, Math.PI * 2); ctx.fill();

      if (r.settled) {
        ctx.fillStyle = 'rgba(232, 242, 244, 0.92)';
        ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(String(r.awarded), padX + trackW - 3, y + 3);
      }
    }

    if (status) {
      status.textContent = settledCount < RUNNERS
        ? `${settledCount} of ${RUNNERS} allocators settled…`
        : 'Awarded set = {1…25}. Unique, gap-free, under 25-way contention.';
      status.classList.toggle('done', settledCount === RUNNERS);
    }

    if (settledCount < RUNNERS) {
      raf = requestAnimationFrame(draw);
      return;
    }
    // Hold the settled result long enough to read, then race again. The point of the loop is
    // that the awarded set comes out {1..25} every time, not just the once you happened to see.
    if (!paused) {
      holdTimer = setTimeout(() => { if (!paused && visible) restart(); }, HOLD_MS);
    }
  }

  function renderStatic() {
    const { w, h } = sizeCanvas();
    ctx.clearRect(0, 0, w, h);
    const padX = 14, trackW = w - padX * 2, laneH = h / RUNNERS;
    runners.forEach((r) => {
      const y = laneH * (r.lane + 0.5);
      ctx.strokeStyle = 'rgba(90, 214, 192, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + trackW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(232, 242, 244, 0.92)';
      ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(r.awarded), padX + trackW - 3, y + 3);
    });
    if (status) {
      status.textContent = 'Awarded set = {1…25}. Unique, gap-free, under 25-way contention.';
      status.classList.add('done');
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    raf = 0; holdTimer = 0;
  }

  function restart() {
    stop();
    runners = makeRunners();
    started = performance.now();
    raf = requestAnimationFrame(draw);
  }

  if (reduce) { renderStatic(); return; }

  // Keep observing rather than unobserving after the first hit: the loop should stop when the
  // figure scrolls away and pick up again when it returns, instead of animating unseen.
  const proofIo = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visible = entry.isIntersecting;
      if (visible && !paused) restart();
      else if (!visible) stop();
    });
  }, { threshold: 0.35 });
  proofIo.observe(proof);

  // A continuously moving figure needs an off switch, so the replay button becomes pause.
  const replay = proof.querySelector('.proof-replay');
  if (replay) {
    replay.textContent = 'Pause';
    replay.setAttribute('aria-pressed', 'false');
    replay.addEventListener('click', () => {
      paused = !paused;
      replay.textContent = paused ? 'Resume' : 'Pause';
      replay.setAttribute('aria-pressed', String(paused));
      if (paused) stop();
      else if (visible) restart();
    });
  }

  // A backgrounded tab should not keep a timer alive.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (visible && !paused) restart();
  });
})();
