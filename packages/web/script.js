import createGlobe from 'https://esm.sh/cobe?bundle';

(() => {
  const palette = [
    { c1: '#d8ece6', c2: '#eef4fb' },
    { c1: '#e6e2f7', c2: '#f5f1fb' },
    { c1: '#f1dde4', c2: '#faf2f0' },
    { c1: '#dcebdd', c2: '#f0f5ea' },
    { c1: '#dbe6f3', c2: '#eff3fa' },
    { c1: '#efe4d7', c2: '#f7f0e6' },
  ];

  const markers = [
    { location: [37.78, -122.42], size: 0.026, id: 'sf' },
    { location: [47.61, -122.33], size: 0.018 },
    { location: [34.05, -118.24], size: 0.02 },
    { location: [40.71, -74.01], size: 0.026, id: 'nyc' },
    { location: [42.36, -71.06], size: 0.018 },
    { location: [43.65, -79.38], size: 0.019 },
    { location: [51.51, -0.13], size: 0.025, id: 'london' },
    { location: [52.52, 13.4], size: 0.021, id: 'berlin' },
    { location: [48.86, 2.35], size: 0.019 },
    { location: [52.37, 4.9], size: 0.016 },
    { location: [41.39, 2.17], size: 0.016 },
    { location: [59.33, 18.07], size: 0.014 },
    { location: [35.68, 139.76], size: 0.028, id: 'tokyo' },
    { location: [37.57, 126.98], size: 0.018 },
    { location: [1.35, 103.82], size: 0.018 },
    { location: [22.28, 114.16], size: 0.016 },
    { location: [12.97, 77.59], size: 0.026, id: 'bangalore' },
    { location: [28.61, 77.21], size: 0.016 },
    { location: [19.07, 72.88], size: 0.016 },
    { location: [-23.55, -46.63], size: 0.026, id: 'saopaulo' },
    { location: [-34.6, -58.38], size: 0.016 },
    { location: [19.43, -99.13], size: 0.018 },
    { location: [25.2, 55.27], size: 0.015 },
    { location: [-33.87, 151.21], size: 0.018 },
  ];

  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [
      Number.parseInt(value.slice(0, 2), 16) / 255,
      Number.parseInt(value.slice(2, 4), 16) / 255,
      Number.parseInt(value.slice(4, 6), 16) / 255,
    ];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mix(a, b, amount) {
    return a.map((value, index) => value + ((b[index] - value) * amount));
  }

  function tint(color, multiplier, lift = 0) {
    return color.map((channel) => clamp((channel * multiplier) + lift, 0, 1));
  }

  function deriveTheme(entry) {
    const top = hexToRgb(entry.c1);
    const bottom = hexToRgb(entry.c2);
    const midpoint = mix(top, bottom, 0.48);

    return {
      base: tint(midpoint, 0.07, 0.012),
      marker: tint(mix(top, bottom, 0.5), 0.14, 0.085),
      glow: tint(mix(top, bottom, 0.32), 0.18, 0.18),
    };
  }

  function themeForSection(entry, sectionId) {
    const theme = deriveTheme(entry);

    if (sectionId === 'global-chat') {
      return {
        base: tint(theme.base, 1.02, 0.004),
        marker: tint(theme.marker, 1.16, 0.01),
        glow: tint(theme.glow, 1.12, 0.02),
      };
    }

    if (sectionId === 'agent-network') {
      return {
        base: tint(theme.base, 0.9, 0.018),
        marker: tint(theme.marker, 1.08, 0.028),
        glow: tint(theme.glow, 1.18, 0.016),
      };
    }

    if (sectionId === 'privacy') {
      return {
        base: tint(theme.base, 0.82, 0.02),
        marker: tint(theme.marker, 0.92, 0.012),
        glow: tint(theme.glow, 0.9, 0.028),
      };
    }

    return theme;
  }

  function animateArray(current, target, easing = 0.05) {
    return current.map((value, index) => value + ((target[index] - value) * easing));
  }

  const sectionMotion = {
    hero: { theta: -0.12, spin: reduceMotion ? 0 : 0.0008, scale: 1.16, offsetY: 10 },
    'global-chat': { theta: -0.08, spin: reduceMotion ? 0 : 0.00088, scale: 1.18, offsetY: 2 },
    'agent-network': { theta: -0.18, spin: reduceMotion ? 0 : 0.0007, scale: 1.12, offsetY: 14 },
    privacy: { theta: -0.04, spin: reduceMotion ? 0 : 0.00056, scale: 1.06, offsetY: 22 },
  };

  let activeSection = 'hero';
  let paletteIndex = 0;
  let currentTheme = themeForSection(palette[paletteIndex], activeSection);
  let targetTheme = themeForSection(palette[paletteIndex], activeSection);

  function applyPalette(index) {
    const entry = palette[index];
    body.style.setProperty('--c1', entry.c1);
    body.style.setProperty('--c2', entry.c2);
    targetTheme = themeForSection(entry, activeSection);
  }

  setInterval(() => {
    paletteIndex = (paletteIndex + 1) % palette.length;
    applyPalette(paletteIndex);
  }, 8000);

  const btn = document.getElementById('copy');
  const commandEl = document.getElementById('command');
  const commandBody = document.querySelector('.command-body');
  const switcher = document.querySelector('.install-switcher');
  const indicator = document.querySelector('.tab-indicator');
  const installTabs = Array.from(document.querySelectorAll('.install-tab'));
  const brandMark = document.querySelector('.brand-mark');
  const floatingUi = document.querySelector('.floating-ui');
  const mobileUtilityToggle = document.getElementById('mobile-utility-toggle');
  const mobileUtilityBackdrop = document.getElementById('mobile-utility-backdrop');
  const heroSection = document.querySelector('.hero');
  const heroPillRow = document.querySelector('.hero-pill-row');
  const sectionLinks = Array.from(document.querySelectorAll('[data-section-link]'));
  const storySections = Array.from(document.querySelectorAll('.story-section'));
  let selectedCommand = commandEl?.textContent?.trim() || 'npx chinwag';
  const mobileMenuQuery = window.matchMedia('(max-width: 840px)');

  function setMobileUtilityOpen(isOpen) {
    if (!floatingUi) {
      return;
    }

    const shouldOpen = isOpen && mobileMenuQuery.matches;
    floatingUi.classList.toggle('is-mobile-open', shouldOpen);
    mobileUtilityToggle?.setAttribute('aria-expanded', String(shouldOpen));
    body.classList.toggle('is-mobile-utility-open', shouldOpen);
  }

  function syncActiveIndicator() {
    if (!switcher || !indicator) {
      return;
    }

    const activeTab = switcher.querySelector('.install-tab.is-active');
    if (!activeTab) {
      return;
    }

    indicator.style.width = `${activeTab.offsetWidth}px`;
    indicator.style.setProperty('--indicator-x', `${activeTab.offsetLeft}px`);
  }

  function setSelectedCommand(command) {
    const isChanged = selectedCommand !== command;
    selectedCommand = command;

    if (commandEl) {
      commandEl.textContent = command;
    }

    if (isChanged && commandBody) {
      commandBody.classList.remove('is-switching');
      window.requestAnimationFrame(() => {
        commandBody.classList.add('is-switching');
      });
    }

    installTabs.forEach((tab) => {
      const isActive = tab.dataset.command === command;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });

    syncActiveIndicator();
  }

  installTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const { command } = tab.dataset;
      if (command) {
        setSelectedCommand(command);
        setMobileUtilityOpen(false);
      }
    });
  });

  if (btn) {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(selectedCommand);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = selectedCommand;
        textarea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      btn.classList.add('ok');
      setTimeout(() => btn.classList.remove('ok'), 1500);
    });
  }

  if (commandBody) {
    commandBody.addEventListener('animationend', () => {
      commandBody.classList.remove('is-switching');
    });
  }

  function setActiveSection(sectionId) {
    activeSection = sectionId;
    body.dataset.activeSection = sectionId;
    targetTheme = themeForSection(palette[paletteIndex], activeSection);

    sectionLinks.forEach((link) => {
      const isActive = link.dataset.sectionLink === sectionId;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    if (heroPillRow) {
      heroPillRow.classList.toggle('has-active', sectionId !== 'hero');
    }
  }

  function scrollToSection(sectionId, updateHistory = true) {
    const isHero = sectionId === 'hero';
    const section = isHero ? heroSection : document.getElementById(sectionId);
    if (!section) {
      return;
    }

    setActiveSection(sectionId);

    if (updateHistory) {
      if (isHero) {
        window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
      } else {
        window.history.pushState(null, '', `#${sectionId}`);
      }
    }

    if (isHero) {
      window.scrollTo({
        top: 0,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      return;
    }

    section.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  sectionLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const sectionId = link.dataset.sectionLink;
      if (!sectionId) {
        return;
      }

      event.preventDefault();
      setMobileUtilityOpen(false);
      scrollToSection(sectionId);
    });
  });

  if (brandMark) {
    brandMark.addEventListener('click', (event) => {
      event.preventDefault();
      setMobileUtilityOpen(false);
      scrollToSection('hero');
    });
  }

  if (mobileUtilityToggle) {
    mobileUtilityToggle.addEventListener('click', () => {
      const isOpen = floatingUi?.classList.contains('is-mobile-open');
      setMobileUtilityOpen(!isOpen);
    });
  }

  if (mobileUtilityBackdrop) {
    mobileUtilityBackdrop.addEventListener('click', () => {
      setMobileUtilityOpen(false);
    });
  }

  window.addEventListener('resize', syncActiveIndicator);
  window.addEventListener('resize', () => {
    if (!mobileMenuQuery.matches) {
      setMobileUtilityOpen(false);
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMobileUtilityOpen(false);
    }
  });
  syncActiveIndicator();
  setMobileUtilityOpen(false);
  setActiveSection('hero');

  if (storySections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visibleEntry) {
        visibleEntry.target.classList.add('is-visible');
        setActiveSection(visibleEntry.target.id);
        return;
      }

      if (heroSection && window.scrollY < heroSection.offsetHeight * 0.45) {
        setActiveSection('hero');
      }
    }, {
      rootMargin: '-30% 0px -42% 0px',
      threshold: [0.18, 0.45, 0.72],
    });

    storySections.forEach((section) => sectionObserver.observe(section));
  }

  window.addEventListener('load', () => {
    const sectionId = window.location.hash.replace('#', '');
    if (sectionId === 'overview') {
      window.requestAnimationFrame(() => {
        scrollToSection('hero', false);
      });
      return;
    }

    if (sectionId && document.getElementById(sectionId)) {
      window.requestAnimationFrame(() => {
        scrollToSection(sectionId, false);
      });
    }
  });

  const canvas = document.getElementById('globe');
  if (!canvas) {
    return;
  }

  const state = {
    phi: 5.78,
    theta: -0.12,
    targetTheta: -0.12,
    autoSpin: reduceMotion ? 0 : 0.0008,
    currentScale: 1.16,
    targetScale: 1.16,
    currentOffsetY: 10,
    targetOffsetY: 10,
    dragSpin: 0,
    pointerX: 0,
    pointerY: 0,
    dragging: false,
    lastX: 0,
    width: 0,
    height: 0,
  };

  let globe;
  let frameId = 0;
  let resizeObserver;

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(canvas.offsetWidth * dpr);
    if (!size || (size === state.width && size === state.height)) {
      return;
    }

    state.width = size;
    state.height = size;
    if (globe) {
      globe.update({ width: size, height: size });
    }
  }

  function render() {
    const motion = sectionMotion[activeSection] || sectionMotion.hero;

    currentTheme = {
      base: animateArray(currentTheme.base, targetTheme.base, 0.04),
      marker: animateArray(currentTheme.marker, targetTheme.marker, 0.045),
      glow: animateArray(currentTheme.glow, targetTheme.glow, 0.04),
    };

    state.autoSpin += (motion.spin - state.autoSpin) * 0.08;
    state.targetScale += (motion.scale - state.targetScale) * 0.08;
    state.currentScale += (state.targetScale - state.currentScale) * 0.08;
    state.targetOffsetY += (motion.offsetY - state.targetOffsetY) * 0.08;
    state.currentOffsetY += (state.targetOffsetY - state.currentOffsetY) * 0.08;
    state.pointerX *= 0.96;
    state.pointerY *= 0.94;
    state.dragSpin *= 0.9;
    state.targetTheta = motion.theta + (state.pointerY * 0.08);
    state.theta += (state.targetTheta - state.theta) * 0.08;
    state.phi += state.autoSpin + state.dragSpin + (state.pointerX * 0.00024);

    globe.update({
      phi: state.phi,
      theta: state.theta,
      width: state.width,
      height: state.height,
      baseColor: currentTheme.base,
      markerColor: currentTheme.marker,
      glowColor: currentTheme.glow,
      opacity: window.innerWidth < 720 ? 0.4 : 0.56,
      scale: state.currentScale,
      offset: [0, state.currentOffsetY],
    });

    frameId = window.requestAnimationFrame(render);
  }

  function destroyGlobe() {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (globe) {
      globe.destroy();
      globe = null;
    }
  }

  function createAmbientGlobe() {
    if (globe) {
      return;
    }

    syncCanvasSize();
    if (!state.width || !state.height) {
      return;
    }

    globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      width: state.width,
      height: state.height,
      phi: state.phi,
      theta: state.theta,
      dark: 1,
      diffuse: 0.7,
      mapSamples: 12000,
      mapBrightness: 0.95,
      mapBaseBrightness: 0.02,
      baseColor: currentTheme.base,
      markerColor: currentTheme.marker,
      glowColor: currentTheme.glow,
      markers,
      markerElevation: 0.01,
      opacity: window.innerWidth < 720 ? 0.4 : 0.56,
      scale: state.currentScale,
      offset: [0, state.currentOffsetY],
      context: { alpha: true, antialias: true },
    });

    resizeObserver = new ResizeObserver(syncCanvasSize);
    resizeObserver.observe(canvas);
    frameId = window.requestAnimationFrame(render);
  }

  function handlePointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) - 0.5;
    const relativeY = ((event.clientY - rect.top) / rect.height) - 0.5;

    state.pointerX = clamp(relativeX, -0.5, 0.5);
    state.pointerY = clamp(relativeY, -0.5, 0.5);

    if (state.dragging) {
      const deltaX = event.clientX - state.lastX;
      state.lastX = event.clientX;
      state.phi -= deltaX * 0.0038;
      state.dragSpin = -deltaX * 0.00006;
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    state.dragging = true;
    state.lastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', (event) => {
    state.dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => {
    state.dragging = false;
  });
  canvas.addEventListener('pointerleave', () => {
    state.dragging = false;
    state.pointerX = 0;
    state.pointerY = 0;
  });

  window.addEventListener('resize', syncCanvasSize);
  window.addEventListener('pagehide', destroyGlobe);

  createAmbientGlobe();
})();
