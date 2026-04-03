import { useRef, useEffect } from 'react';

export function useTabKeyboard(tabIds, setActiveTab) {
  const containerRef = useRef(null);
  const tabIdsRef = useRef(tabIds);
  useEffect(() => {
    tabIdsRef.current = tabIds;
  });

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      const ids = tabIdsRef.current;
      setActiveTab((prev) => {
        const cur = ids.indexOf(prev);
        const next =
          e.key === 'ArrowRight'
            ? ids[(cur + 1) % ids.length]
            : ids[(cur - 1 + ids.length) % ids.length];
        containerRef.current?.querySelector(`[data-tab="${next}"]`)?.focus();
        return next;
      });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setActiveTab]);

  return containerRef;
}
