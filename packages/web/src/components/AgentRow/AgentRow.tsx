import { useState, useCallback } from 'react';
import clsx from 'clsx';
import type { Member } from '../../lib/apiSchemas.js';
import { formatDuration } from '../../lib/utils.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './AgentRow.module.css';

interface Props {
  agent: Member;
  /** When set, show stop/message action buttons for this agent. */
  teamId?: string;
  onCommand?: (type: 'stop' | 'message', payload: Record<string, unknown>) => Promise<void>;
}

export default function AgentRow({ agent, teamId, onCommand }: Props) {
  const isActive = agent.status === 'active';
  const tool = agent.host_tool && agent.host_tool !== 'unknown' ? agent.host_tool : null;
  const files = agent.activity?.files || [];
  const summary = agent.activity?.summary || '';
  const duration = formatDuration(agent.session_minutes);

  const [showMessage, setShowMessage] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  // Show first 2 file basenames
  const fileDisplay =
    files.length > 0
      ? files
          .slice(0, 2)
          .map((f) => f.split('/').pop())
          .join(', ') + (files.length > 2 ? ` +${files.length - 2}` : '')
      : null;

  // Filter out useless summaries
  const showSummary = summary && !/^editing\s/i.test(summary);
  const canAct = isActive && teamId && onCommand;

  const handleStop = useCallback(async () => {
    if (!canAct) return;
    await onCommand!('stop', { agent_id: agent.agent_id });
  }, [canAct, onCommand, agent.agent_id]);

  const handleSendMessage = useCallback(async () => {
    if (!canAct || !messageText.trim()) return;
    setSending(true);
    try {
      await onCommand!('message', { text: messageText.trim(), target: agent.agent_id });
      setMessageText('');
      setShowMessage(false);
    } finally {
      setSending(false);
    }
  }, [canAct, onCommand, messageText, agent.agent_id]);

  return (
    <div>
      <div className={clsx(styles.row, !isActive && styles.offline)}>
        <div className={styles.identity}>
          <span className={clsx(styles.dot, isActive ? styles.dotOn : styles.dotOff)} />
          {tool && <ToolIcon tool={tool} size={16} monochrome={!isActive} />}
        </div>
        <div className={styles.info}>
          <span className={styles.handle}>{agent.handle}</span>
          <div className={styles.metaRow}>
            {tool ? <span className={styles.tool}>{tool}</span> : null}
            {fileDisplay ? <span className={styles.files}>{fileDisplay}</span> : null}
            {showSummary && !fileDisplay ? <span className={styles.summary}>{summary}</span> : null}
          </div>
        </div>
        {canAct && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionBtn}
              title="Send message"
              onClick={() => setShowMessage((v) => !v)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button
              type="button"
              className={clsx(styles.actionBtn, styles.stopBtn)}
              title="Stop agent"
              onClick={handleStop}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          </div>
        )}
        {duration && <span className={styles.time}>{duration}</span>}
      </div>
      {showMessage && canAct && (
        <div className={styles.messageRow}>
          <input
            className={styles.messageInput}
            placeholder="Message this agent..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
              if (e.key === 'Escape') setShowMessage(false);
            }}
            disabled={sending}
            autoFocus
          />
          <button
            type="button"
            className={styles.sendBtn}
            disabled={!messageText.trim() || sending}
            onClick={handleSendMessage}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}
