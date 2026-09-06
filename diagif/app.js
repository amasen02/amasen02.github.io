(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const picker = $('#scene-picker');
  const playToggle = $('#play-toggle');
  const playLabel = playToggle.querySelector('.play-label');
  const scrub = $('#scrub');
  const timeOutput = $('#time-output');
  const sceneJson = $('#scene-json');
  const sceneDomain = $('#scene-domain');
  const renderState = $('#render-state');
  const canvasShell = $('.canvas-shell');
  const galleryGrid = $('#gallery-grid');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rendererFonts = [
    '"Lilita One"',
    '"Bebas Neue"',
    '"Inter"',
    '"Patrick Hand"',
    '"JetBrains Mono"',
    '"Space Mono"',
    '"Permanent Marker"'
  ];

  const state = {
    manifest: null,
    scene: null,
    sceneMeta: null,
    timeMs: 0,
    startedAt: 0,
    playing: false,
    rafId: 0,
    loadToken: 0
  };

  function formatTime(milliseconds) {
    const seconds = Math.max(0, milliseconds) / 1000;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  }

  function updateTimeUi() {
    const duration = state.scene?.timeline?.durationMs || 0;
    scrub.value = String(Math.min(state.timeMs, duration));
    timeOutput.value = `${formatTime(state.timeMs)} / ${formatTime(duration)}`;
    timeOutput.textContent = timeOutput.value;
  }

  function setPlaying(next) {
    if (!state.scene) return;
    state.playing = Boolean(next);
    playToggle.dataset.playing = String(state.playing);
    playToggle.setAttribute('aria-label', state.playing ? 'Pause animation' : 'Play animation');
    playLabel.textContent = state.playing ? 'Pause' : 'Play';
    cancelAnimationFrame(state.rafId);
    if (state.playing) {
      state.startedAt = performance.now() - state.timeMs;
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function seek(timeMs) {
    if (!state.scene || !window.__TECH_GIF__) return;
    const duration = state.scene.timeline.durationMs;
    state.timeMs = Math.max(0, Math.min(Number(timeMs) || 0, duration));
    window.__TECH_GIF__.seek(state.timeMs);
    updateTimeUi();
  }

  function tick(now) {
    if (!state.playing || !state.scene) return;
    const duration = state.scene.timeline.durationMs;
    let next = now - state.startedAt;
    if (next >= duration) {
      if (state.scene.timeline.loop) {
        next %= duration;
        state.startedAt = now - next;
      } else {
        seek(duration);
        setPlaying(false);
        return;
      }
    }
    seek(next);
    state.rafId = requestAnimationFrame(tick);
  }

  function showRenderMessage(message, isError = false) {
    renderState.hidden = false;
    renderState.textContent = message;
    renderState.dataset.error = String(isError);
    canvasShell.setAttribute('aria-busy', String(!isError));
  }

  // The demo lives at /diagif/ but the manifest stores paths relative to the site root
  // ("assets/scenes/..."), so resolve every asset against the parent directory rather than
  // against this page. Fixing the base once keeps each call site unchanged.
  const ASSET_BASE = new URL('../', document.baseURI);

  function fileUrl(file) {
    return new URL(file, ASSET_BASE).href;
  }

  async function loadRendererFonts() {
    await Promise.all(rendererFonts.flatMap((family) => [
      document.fonts.load(`400 24px ${family}`),
      document.fonts.load(`700 24px ${family}`)
    ]));
    await document.fonts.ready;
  }

  async function loadScene(meta) {
    const token = ++state.loadToken;
    setPlaying(false);
    document.body.dataset.ready = 'false';
    picker.disabled = true;
    playToggle.disabled = true;
    scrub.disabled = true;
    showRenderMessage(`Loading ${meta.title}…`);

    try {
      const response = await fetch(fileUrl(meta.file));
      if (!response.ok) throw new Error(`Scene request failed (${response.status})`);
      const scene = await response.json();
      if (token !== state.loadToken) return;
      if (!scene?.timeline || !Number.isFinite(scene.timeline.durationMs)) throw new Error('Scene is missing timeline.durationMs');
      if (!window.__TECH_GIF__?.mount) throw new Error('Renderer bundle did not expose window.__TECH_GIF__');

      await loadRendererFonts();
      const result = window.__TECH_GIF__.mount(scene);
      state.scene = scene;
      state.sceneMeta = meta;
      state.timeMs = 0;
      sceneJson.textContent = JSON.stringify(scene, null, 2);
      sceneDomain.textContent = meta.domain || 'Technical diagram';
      scrub.max = String(scene.timeline.durationMs);
      scrub.value = '0';
      renderState.hidden = true;
      canvasShell.setAttribute('aria-busy', 'false');
      picker.disabled = false;
      playToggle.disabled = false;
      scrub.disabled = false;
      updateTimeUi();
      document.body.dataset.scene = meta.id;
      document.body.dataset.geometryChecks = String(result.geometrySelfCheck.length);
      document.body.dataset.ready = 'true';
      if (!reduceMotion.matches) setPlaying(true);
    } catch (error) {
      console.error(error);
      sceneJson.textContent = JSON.stringify({ error: error.message }, null, 2);
      showRenderMessage(`Could not mount this scene: ${error.message}`, true);
      picker.disabled = false;
    }
  }

  function galleryMetadata(item) {
    const parts = [item.domain];
    if (item.durationMs) parts.push(`${(item.durationMs / 1000).toFixed(1)} s`);
    if (item.bytes) parts.push(`${Math.round(item.bytes / 1024)} KB`);
    return parts.filter(Boolean).join(' · ');
  }

  function loadGalleryImage(container, item) {
    container.textContent = '';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = fileUrl(item.file);
    image.alt = item.alt || `${item.title} animated technical diagram`;
    container.append(image);
  }

  function renderGallery(items) {
    galleryGrid.textContent = '';
    if (!items.length) {
      galleryGrid.innerHTML = '<p class="loading-copy">No gallery examples are listed in the manifest.</p>';
      return;
    }

    items.slice(0, 12).forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'gallery-card';
      const media = document.createElement('div');
      media.className = 'gallery-media';
      if (Number(item.width) > 0 && Number(item.height) > 0) media.style.aspectRatio = `${item.width} / ${item.height}`;
      if (reduceMotion.matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Load animation: ${item.title}`;
        button.addEventListener('click', () => loadGalleryImage(media, item), { once: true });
        media.append(button);
      } else {
        loadGalleryImage(media, item);
      }

      const copy = document.createElement('div');
      copy.className = 'gallery-copy';
      const words = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = item.title;
      const meta = document.createElement('p');
      meta.textContent = galleryMetadata(item);
      const number = document.createElement('span');
      number.className = 'gallery-index';
      number.textContent = String(index + 1).padStart(2, '0');
      words.append(title, meta);
      copy.append(words, number);
      card.append(media, copy);
      galleryGrid.append(card);
    });
  }

  async function initialise() {
    document.body.dataset.ready = 'false';
    try {
      const response = await fetch(fileUrl('assets/manifest.json'));
      if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
      const manifest = await response.json();
      if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) throw new Error('Manifest has no live scenes');
      state.manifest = manifest;
      picker.textContent = '';
      manifest.scenes.forEach((scene) => {
        const option = document.createElement('option');
        option.value = scene.id;
        option.textContent = scene.title;
        picker.append(option);
      });
      renderGallery(Array.isArray(manifest.gallery) ? manifest.gallery : []);
      const featured = manifest.scenes.find((scene) => /idempotency/i.test(scene.id)) || manifest.scenes[0];
      picker.value = featured.id;
      await loadScene(featured);
    } catch (error) {
      console.error(error);
      sceneJson.textContent = JSON.stringify({ error: error.message }, null, 2);
      showRenderMessage(`Demo assets are unavailable: ${error.message}`, true);
      galleryGrid.innerHTML = '<p class="loading-copy">Gallery assets are unavailable.</p>';
    }
  }

  picker.addEventListener('change', () => {
    const selected = state.manifest?.scenes.find((scene) => scene.id === picker.value);
    if (selected) loadScene(selected);
  });
  playToggle.addEventListener('click', () => setPlaying(!state.playing));
  scrub.addEventListener('input', () => {
    const wasPlaying = state.playing;
    seek(Number(scrub.value));
    if (wasPlaying) state.startedAt = performance.now() - state.timeMs;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing) setPlaying(false);
  });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) setPlaying(false);
    if (state.manifest) renderGallery(Array.isArray(state.manifest.gallery) ? state.manifest.gallery : []);
  });

  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      const copy = target.cloneNode(true);
      copy.querySelectorAll('.code-prompt').forEach((prompt) => prompt.remove());
      const commandText = copy.textContent.trim();
      try {
        await navigator.clipboard.writeText(commandText);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1600);
      } catch {
        button.textContent = 'Select text';
        const range = document.createRange();
        range.selectNodeContents(target);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
    });
  });

  initialise();
})();
