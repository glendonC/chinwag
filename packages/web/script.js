(() => {
  const body = document.body;

  const btn = document.getElementById('copy');
  const commandEl = document.getElementById('command');
  const commandPill = document.getElementById('pill');
  const commandLabel = commandPill?.querySelector('.command-label');
  const controlSurface = document.querySelector('.control-surface');
  const controlRail = document.querySelector('.control-rail');
  const floatingUi = document.querySelector('.floating-ui');
  const mobileUtilityToggle = document.getElementById('mobile-utility-toggle');
  const mobileUtilityBackdrop = document.getElementById('mobile-utility-backdrop');
  const sectionLinks = Array.from(document.querySelectorAll('[data-section-link]'));
  const observedSections = Array.from(document.querySelectorAll('main section[id]'));
  const revealNodes = Array.from(document.querySelectorAll('.reveal'));

  let selectedCommand = commandEl?.textContent?.trim() || 'npx chinwag';

  function setMobileUtilityOpen(isOpen) {
    if (!floatingUi) {
      return;
    }

    floatingUi.classList.toggle('is-mobile-open', isOpen);
    mobileUtilityToggle?.setAttribute('aria-expanded', String(isOpen));
  }

  function updateHeaderLayout() {
    if (!floatingUi || !controlRail || !controlSurface || !commandPill) {
      return;
    }

    if (window.innerWidth <= 920) {
      floatingUi.style.removeProperty('--command-width');
      floatingUi.style.removeProperty('--command-offset');
      floatingUi.style.removeProperty('--command-max-width');
      return;
    }

    const railRect = controlRail.getBoundingClientRect();
    const railWidth = railRect.width;
    const labelWidth = commandLabel?.getBoundingClientRect().width || 0;
    const bodyWidth = commandEl?.scrollWidth || 0;
    const copyWidth = btn?.getBoundingClientRect().width || 0;
    const pillStyles = window.getComputedStyle(commandPill);
    const paddingLeft = Number.parseFloat(pillStyles.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(pillStyles.paddingRight) || 0;
    const gap = Number.parseFloat(pillStyles.columnGap || pillStyles.gap) || 0;
    const naturalWidth = Math.ceil(labelWidth + bodyWidth + copyWidth + paddingLeft + paddingRight + (gap * 2));
    const maxWidth = Math.ceil(railWidth);
    const width = Math.min(naturalWidth, maxWidth);
    const offset = Math.max(0, Math.round((railWidth - width) / 2));

    floatingUi.style.setProperty('--command-width', `${width}px`);
    floatingUi.style.setProperty('--command-max-width', `${maxWidth}px`);
    floatingUi.style.setProperty('--command-offset', `${offset}px`);
  }

  function setActiveSection(sectionId) {
    sectionLinks.forEach((link) => {
      const isActive = link.dataset.sectionLink === sectionId;
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
      window.setTimeout(() => btn.classList.remove('ok'), 1500);
    });
  }

  if (mobileUtilityToggle) {
    mobileUtilityToggle.addEventListener('click', () => {
      const isOpen = !floatingUi?.classList.contains('is-mobile-open');
      setMobileUtilityOpen(isOpen);
    });
  }

  if (mobileUtilityBackdrop) {
    mobileUtilityBackdrop.addEventListener('click', () => {
      setMobileUtilityOpen(false);
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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMobileUtilityOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    updateHeaderLayout();
  });

  if ('ResizeObserver' in window) {
    const switcherObserver = new ResizeObserver(() => {
      updateHeaderLayout();
    });

    if (controlSurface) {
      switcherObserver.observe(controlSurface);
    }
    if (commandPill) {
      switcherObserver.observe(commandPill);
    }
  }

  if (observedSections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) {
        setActiveSection(visible.target.id);
      }
    }, {
      rootMargin: '-24% 0px -55% 0px',
      threshold: [0.18, 0.38, 0.6],
    });

    observedSections.forEach((section) => sectionObserver.observe(section));
  }

  if (revealNodes.length) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.12,
    });

    revealNodes.forEach((node) => revealObserver.observe(node));
  }

  setMobileUtilityOpen(false);
  updateHeaderLayout();

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && document.getElementById(initialHash)) {
    setActiveSection(initialHash);
  } else {
    setActiveSection('overview');
  }
})();
