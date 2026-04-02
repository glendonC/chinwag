import { useRef, useEffect } from 'react';

export function useTabKeyboard(tabIds, setActiveTab) {
  const containerRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      setActiveTab((prev) => {
        const cur = tabIds.indexOf(prev);
        const next = e.key === 'ArrowRight'
          ? tabIds[(cur + 1) % tabIds.length]
          : tabIds[(cur - 1 + tabIds.length) % tabIds.length];
        containerRef.current?.querySelector(`[data-tab="${next}"]`)?.focus();
        return next;
      });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tabIds, setActiveTab]);

  return containerRef;
}
