import { useState } from 'react';
import styles from './MessageComposer.module.css';

export default function MessageComposer({ onSend }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function handleSend() {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(msg);
      setText('');
    } catch (err) {
      setError(err.message || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={500}
          disabled={sending}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!text.trim() || sending}
          aria-label="Send message"
        >
          {sending ? (
            <span className={styles.sendingDot} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 8l12-5-5 12-2-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
