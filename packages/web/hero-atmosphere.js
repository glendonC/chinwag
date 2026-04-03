export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const LABEL_SEQUENCE = [
  'claude',
  'vscode',
  'cursor',
  'codex',
  'windsurf',
  'jetbrains',
  'aider',
  'amazonq',
  'zed',
  'cline',
];

function getHeroParticleClusters(width, height) {
  return [
    {
      x: 0.22,
      y: 0.22,
      spreadX: width * 0.14,
      spreadY: height * 0.12,
      glow: width * 0.14,
      color: 'rgba(212, 154, 174, 0.10)',
    },
    {
      x: 0.38,
      y: 0.34,
      spreadX: width * 0.14,
      spreadY: height * 0.12,
      glow: width * 0.16,
      color: 'rgba(168, 150, 212, 0.10)',
    },
    {
      x: 0.58,
      y: 0.5,
      spreadX: width * 0.18,
      spreadY: height * 0.14,
      glow: width * 0.22,
      color: 'rgba(142, 192, 164, 0.12)',
    },
    {
      x: 0.74,
      y: 0.28,
      spreadX: width * 0.14,
      spreadY: height * 0.12,
      glow: width * 0.16,
      color: 'rgba(232, 212, 160, 0.10)',
    },
    {
      x: 0.3,
      y: 0.72,
      spreadX: width * 0.14,
      spreadY: height * 0.12,
      glow: width * 0.15,
      color: 'rgba(142, 192, 164, 0.10)',
    },
    {
      x: 0.72,
      y: 0.72,
      spreadX: width * 0.14,
      spreadY: height * 0.12,
      glow: width * 0.15,
      color: 'rgba(212, 154, 174, 0.08)',
    },
  ];
}

const PARTICLE_COLORS = [
  [212, 154, 174], // pink
  [168, 150, 212], // lavender
  [142, 192, 164], // sage
  [232, 212, 160], // amber
  [180, 160, 140], // warm neutral
];

function createHeroParticles(width, height) {
  const count = Math.round(clamp((width * height) / 520, 520, 1100));
  const clusters = getHeroParticleClusters(width, height);

  return Array.from({ length: count }, () => {
    const cluster = clusters[Math.floor(Math.random() * clusters.length)];
    const jitterX = (Math.random() + Math.random() + Math.random() - 1.5) * cluster.spreadX;
    const jitterY = (Math.random() + Math.random() + Math.random() - 1.5) * cluster.spreadY;
    const isBright = Math.random() < 0.1;
    const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];

    return {
      baseX: clamp(cluster.x * width + jitterX, 0, width),
      baseY: clamp(cluster.y * height + jitterY, 0, height),
      radius: isBright ? 1.8 + Math.random() * 1.8 : 0.45 + Math.random() * 1.4,
      alpha: isBright ? 0.45 + Math.random() * 0.2 : 0.12 + Math.random() * 0.3,
      offset: 1 + Math.random() * 11,
      speed: 0.28 + Math.random() * 0.72,
      phase: Math.random() * Math.PI * 2,
      color,
    };
  });
}

function drawHeroGlow(context, x, y, radius, color) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

export function createHeroAtmosphere({
  container,
  canvas,
  prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
}) {
  let frame = 0;
  let stepTimer = 0;
  let width = 0;
  let height = 0;
  let particles = [];
  let currentVisibleLimit = 0;
  let sequenceIndex = 0;
  let orderedLabels = [];
  let visibleQueue = [];

  const labels = Array.from(container?.querySelectorAll('[data-hero-label]') ?? []).map((node) => ({
    id: node.dataset.heroLabel || '',
    node,
    showTimer: 0,
    enterTimer: 0,
  }));

  function getVisibleLimit() {
    if (width && width < 560) {
      return 2;
    }

    return 3;
  }

  function clearTimer(label, key) {
    if (!label[key]) {
      return;
    }

    window.clearTimeout(label[key]);
    label[key] = 0;
  }

  function clearAllLabelTimers() {
    labels.forEach((label) => {
      clearTimer(label, 'showTimer');
      clearTimer(label, 'enterTimer');
    });

    if (stepTimer) {
      window.clearTimeout(stepTimer);
      stepTimer = 0;
    }
  }

  function resetLabels() {
    labels.forEach((label) => {
      label.node.classList.remove('is-visible', 'is-entering');
    });

    visibleQueue = [];
  }

  function resize(force = false) {
    if (!container || !canvas) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);

    if (!nextWidth || !nextHeight) {
      return;
    }

    if (!force && nextWidth === width && nextHeight === height) {
      return;
    }

    width = nextWidth;
    height = nextHeight;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);

    particles = createHeroParticles(width, height);
  }

  function draw(timestamp = 0) {
    if (!canvas || !width || !height) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const time = timestamp * 0.001;
    const clusters = getHeroParticleClusters(width, height);

    context.clearRect(0, 0, width, height);

    clusters.forEach((cluster) => {
      drawHeroGlow(context, width * cluster.x, height * cluster.y, cluster.glow, cluster.color);
    });

    particles.forEach((particle) => {
      const wobbleX = Math.cos(time * particle.speed + particle.phase) * particle.offset;
      const wobbleY =
        Math.sin(time * particle.speed * 1.18 + particle.phase) * particle.offset * 0.62;
      const twinkle =
        0.78 + ((Math.sin(time * particle.speed * 2.1 + particle.phase) + 1) / 2) * 0.34;
      const [r, g, b] = particle.color;
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${particle.alpha * twinkle})`;
      context.beginPath();
      context.arc(
        particle.baseX + wobbleX,
        particle.baseY + wobbleY,
        particle.radius,
        0,
        Math.PI * 2,
      );
      context.fill();
    });

    if (!prefersReducedMotion) {
      frame = window.requestAnimationFrame(draw);
    }
  }

  function scheduleEnterCleanup(label) {
    clearTimer(label, 'enterTimer');

    if (prefersReducedMotion) {
      return;
    }

    label.enterTimer = window.setTimeout(() => {
      label.enterTimer = 0;
      label.node.classList.remove('is-entering');
    }, 1040);
  }

  function showLabel(label, delay = 0) {
    clearTimer(label, 'showTimer');

    label.showTimer = window.setTimeout(() => {
      label.showTimer = 0;
      label.node.classList.remove('is-entering');
      label.node.classList.add('is-visible');

      if (prefersReducedMotion) {
        return;
      }

      window.requestAnimationFrame(() => {
        label.node.classList.add('is-entering');
      });

      scheduleEnterCleanup(label);
    }, delay);
  }

  function hideLabel(label) {
    clearTimer(label, 'enterTimer');
    label.node.classList.remove('is-entering');
    label.node.classList.remove('is-visible');
  }

  function scheduleAdvance(delay = 1700) {
    if (prefersReducedMotion || orderedLabels.length <= currentVisibleLimit) {
      return;
    }

    if (stepTimer) {
      window.clearTimeout(stepTimer);
    }

    stepTimer = window.setTimeout(() => {
      stepTimer = 0;

      const leavingLabel = visibleQueue.shift();
      if (leavingLabel) {
        hideLabel(leavingLabel);
      }

      const nextLabel = orderedLabels[sequenceIndex % orderedLabels.length];
      sequenceIndex = (sequenceIndex + 1) % orderedLabels.length;

      if (nextLabel) {
        showLabel(nextLabel);
        visibleQueue.push(nextLabel);
      }

      scheduleAdvance(1700);
    }, delay);
  }

  function start() {
    if (!container || !canvas) {
      return;
    }

    resize(true);

    if (frame) {
      window.cancelAnimationFrame(frame);
    }

    frame = 0;
    clearAllLabelTimers();
    resetLabels();

    currentVisibleLimit = getVisibleLimit();
    orderedLabels = LABEL_SEQUENCE.map((id) => labels.find((label) => label.id === id)).filter(
      Boolean,
    );
    sequenceIndex = orderedLabels.length ? currentVisibleLimit % orderedLabels.length : 0;

    if (prefersReducedMotion) {
      orderedLabels.slice(0, currentVisibleLimit).forEach((label) => {
        label.node.classList.add('is-visible');
        visibleQueue.push(label);
      });

      draw(0);
      return;
    }

    orderedLabels.slice(0, currentVisibleLimit).forEach((label, index) => {
      visibleQueue.push(label);
      showLabel(label, 240 + index * 680);
    });

    scheduleAdvance(4300);
    frame = window.requestAnimationFrame(draw);
  }

  function stop() {
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }

    clearAllLabelTimers();
  }

  function initialize() {
    const ResizeObserverCtor = window.ResizeObserver;
    if (ResizeObserverCtor && container) {
      const observer = new ResizeObserverCtor(() => {
        resize();

        if (currentVisibleLimit && currentVisibleLimit !== getVisibleLimit()) {
          start();
        }
      });
      observer.observe(container);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    });

    start();
  }

  return {
    initialize,
    resize,
    start,
    stop,
  };
}
