export function createHeaderUi({
  floatingUi,
  controlRail,
  controlSurface,
  commandPill,
  commandLabel,
  commandEl,
  copyButton,
  mobileUtilityToggle,
  mobileUtilityBackdrop,
}) {
  const selectedCommand = commandEl?.textContent?.trim() || 'npx chinwag init';

  function setMobileUtilityOpen(isOpen) {
    if (!floatingUi) {
      return;
    }

    floatingUi.classList.toggle('is-mobile-open', isOpen);
    mobileUtilityToggle?.setAttribute('aria-expanded', String(isOpen));
  }

  function initializeCopyButton() {
    if (!copyButton) {
      return;
    }

    copyButton.addEventListener('click', async (event) => {
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

      copyButton.classList.add('ok');
      window.setTimeout(() => copyButton.classList.remove('ok'), 1500);
    });
  }

  function initializeMobileMenu() {
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

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setMobileUtilityOpen(false);
      }
    });
  }

  function initialize() {
    initializeCopyButton();
    initializeMobileMenu();
    setMobileUtilityOpen(false);
  }

  return {
    initialize,
    setMobileUtilityOpen,
  };
}
