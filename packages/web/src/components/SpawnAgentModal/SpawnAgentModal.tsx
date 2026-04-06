import { useState, useCallback } from 'react';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { teamActions } from '../../lib/stores/teams.js';
import styles from './SpawnAgentModal.module.css';

// All tools that can be spawned — keyed by registry ID.
// Only shown if the daemon reports them as available.
const TOOL_INFO: Record<string, { metaId: string; desc: string; type: string }> = {
  'claude-code': { metaId: 'claude', desc: 'Anthropic terminal agent', type: 'CLI' },
  codex: { metaId: 'codex', desc: 'OpenAI terminal agent', type: 'CLI' },
  aider: { metaId: 'aider', desc: 'Open-source pair programmer', type: 'CLI' },
  'amazon-q': { metaId: 'amazonq', desc: 'AWS coding assistant', type: 'CLI' },
};

interface SpawnFormProps {
  teamId: string;
  /** Tool IDs available on the connected daemon. Empty = no daemon. */
  availableTools: string[];
  onClose: () => void;
}

export default function SpawnForm({ teamId, availableTools, onClose }: SpawnFormProps) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const tools = availableTools
    .filter((id) => TOOL_INFO[id])
    .map((id) => ({ registryId: id, ...TOOL_INFO[id] }));

  const handleSpawn = useCallback(
    async (registryId: string) => {
      if (status === 'sending') return;
      setStatus('sending');
      setErrorMsg('');

      try {
        const result = await teamActions.submitCommand(teamId, 'spawn', {
          tool_id: registryId,
        });

        if (result.error) {
          setStatus('error');
          setErrorMsg(result.error);
          return;
        }

        setStatus('sent');
        setTimeout(onClose, 400);
      } catch (err) {
        setStatus('error');
        setErrorMsg((err as Error).message || 'Failed to send command');
      }
    },
    [teamId, status, onClose],
  );

  if (tools.length === 0) {
    return (
      <div className={styles.form}>
        <p className={styles.empty}>
          No spawnable tools detected. Open a chinwag-connected tool (Claude Code, Cursor, etc.) in
          this project to enable remote spawning.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <div
        className={styles.tableWrap}
        style={
          {
            '--spawn-grid': 'minmax(140px, 1.2fr) minmax(120px, 1.6fr) 60px 60px',
          } as React.CSSProperties
        }
      >
        <div className={styles.tableHead}>
          <span className={styles.th}>Tool</span>
          <span className={styles.th}>Description</span>
          <span className={styles.th}>Type</span>
          <span className={styles.thRight}></span>
        </div>
        <div className={styles.tableBody}>
          {tools.map((tool, i) => {
            const meta = getToolMeta(tool.metaId);
            return (
              <button
                key={tool.registryId}
                type="button"
                className={styles.toolRow}
                style={{ '--row-index': i } as React.CSSProperties}
                onClick={() => handleSpawn(tool.registryId)}
                disabled={status === 'sending'}
              >
                <span className={styles.tdTool}>
                  <ToolIcon tool={tool.metaId} size={18} />
                  {meta.label}
                </span>
                <span className={styles.tdDesc}>{tool.desc}</span>
                <span className={styles.tdType}>{tool.type}</span>
                <span className={styles.tdAction}>Spawn</span>
              </button>
            );
          })}
        </div>
      </div>

      {status === 'error' && <p className={styles.error}>{errorMsg}</p>}
    </div>
  );
}
