import { createHeaderUi } from './header-ui.js';
import { createHeroAtmosphere, clamp } from './hero-atmosphere.js';

const prefersReducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const sectionLinks = Array.from(document.querySelectorAll('[data-section-link]'));
const observedSections = Array.from(document.querySelectorAll('main section[id]'));
const journeySections = Array.from(document.querySelectorAll('[data-journey-stage]'));
const revealNodes = Array.from(document.querySelectorAll('.reveal'));
const IntersectionObserverCtor = window.IntersectionObserver;

const sectionNavMap = {
  overview: 'overview',
  features: 'features',
  remember: 'features',
  coordinate: 'features',
  observe: 'features',
  security: 'security',
};

const headerUi = createHeaderUi({
  floatingUi: document.querySelector('.floating-ui'),
  controlRail: document.querySelector('.control-rail'),
  controlSurface: document.querySelector('.control-surface'),
  commandPill: document.getElementById('pill'),
  commandLabel: document.querySelector('#pill .command-label'),
  commandEl: document.getElementById('command'),
  copyButton: document.getElementById('copy'),
  mobileUtilityToggle: document.getElementById('mobile-utility-toggle'),
  mobileUtilityBackdrop: document.getElementById('mobile-utility-backdrop'),
});

const heroAtmosphere = createHeroAtmosphere({
  container: document.getElementById('hero-atmosphere'),
  canvas: document.getElementById('hero-particles'),
  prefersReducedMotion,
});

const scrollJourney = createScrollJourney({
  sections: journeySections,
});

function setActiveSection(sectionId) {
  const navId = sectionNavMap[sectionId] || sectionId;
  sectionLinks.forEach((link) => {
    const isActive = link.dataset.sectionLink === navId;
    link.classList.toggle('is-active', isActive);

    if (isActive) {
      link.setAttribute('aria-current', 'true');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }

  section.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

function createScrollJourney({ sections }) {
  const sectionConfigs = sections
    .map((node) => ({
      node,
      stage: node.dataset.journeyStage || '',
    }))
    .filter((section) => section.stage);

  let frame = 0;

  function update() {
    frame = 0;

    if (!sectionConfigs.length) {
      return;
    }

    const viewportHeight = Math.max(window.innerHeight || 0, 1);
    const viewportAnchor = viewportHeight * 0.56;
    let activeNode = null;
    let activeScore = -1;

    sectionConfigs.forEach(({ node }) => {
      const rect = node.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(center - viewportAnchor);
      const presence = clamp(1 - distance / (viewportHeight * 0.95), 0, 1);

      node.style.setProperty('--section-presence', presence.toFixed(4));

      if (presence > activeScore) {
        activeScore = presence;
        activeNode = node;
      }
    });

    sectionConfigs.forEach(({ node }) => {
      node.classList.toggle('is-stage-active', node === activeNode);
    });
  }

  function requestUpdate() {
    if (!frame) {
      frame = window.requestAnimationFrame(update);
    }
  }

  function initialize() {
    if (!sectionConfigs.length) {
      return;
    }

    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
  }

  return {
    initialize,
  };
}

sectionLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const sectionId = link.dataset.sectionLink;
    if (!sectionId) {
      return;
    }

    event.preventDefault();
    headerUi.setMobileUtilityOpen(false);
    scrollToSection(sectionId);
  });
});

if (IntersectionObserverCtor && observedSections.length) {
  const sectionObserver = new IntersectionObserverCtor(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) {
        setActiveSection(visible.target.id);
      }
    },
    {
      rootMargin: '-24% 0px -55% 0px',
      threshold: [0.18, 0.38, 0.6],
    },
  );

  observedSections.forEach((section) => sectionObserver.observe(section));
}

if (IntersectionObserverCtor && revealNodes.length) {
  const revealObserver = new IntersectionObserverCtor(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.12,
    },
  );

  revealNodes.forEach((node) => revealObserver.observe(node));
}

const animatedSections = [
  document.getElementById('coord-feed'),
  document.getElementById('trust-viz'),
];

if (IntersectionObserverCtor) {
  const staggerObserver = new IntersectionObserverCtor(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-animated');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.15 },
  );

  animatedSections.forEach((el) => {
    if (el) staggerObserver.observe(el);
  });
}

headerUi.initialize();
heroAtmosphere.initialize();
scrollJourney.initialize();

const initialHash = window.location.hash.replace('#', '');
if (initialHash && document.getElementById(initialHash)) {
  setActiveSection(initialHash);
} else {
  setActiveSection('overview');
}
