import { useState, useRef, useEffect } from 'react';

/**
 * Custom hook for managing notice/flash messages in the dashboard.
 */
export function useNotice() {
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  useEffect(() => () => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
  }, []);

  function flash(msg, duration = 3000) {
    const tone = typeof duration === 'object' ? duration.tone || 'info' : 'info';
    const autoClearMs = typeof duration === 'object'
      ? (duration.autoClearMs ?? (tone === 'error' || tone === 'warning' ? null : 4000))
      : duration;

    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }

    setNotice({ text: msg, tone });

    if (autoClearMs && autoClearMs > 0) {
      noticeTimer.current = setTimeout(() => {
        setNotice(current => (current?.text === msg ? null : current));
        noticeTimer.current = null;
      }, autoClearMs);
    }
  }

  return { notice, flash };
}
