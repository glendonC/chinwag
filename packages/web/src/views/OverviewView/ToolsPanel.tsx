import { getToolMeta } from '../../lib/toolMeta.js';
import { arcPath, CX, CY, R, SW, type ArcEntry } from './useOverviewData.js';
import styles from './OverviewView.module.css';

interface ToolUsageEntry {
  tool: string;
  joins: number;
  share: number;
}

interface HostConfigured {
  host_tool?: string;
  joins: number;
  [key: string]: unknown;
}

interface TeamSummary {
  team_id: string;
  team_name?: string;
  hosts_configured?: HostConfigured[];
  [key: string]: unknown;
}

interface ToolsPanelProps {
  arcs: ArcEntry[];
  toolUsage: ToolUsageEntry[];
  uniqueTools: number;
  summaries: TeamSummary[];
}

export default function ToolsPanel({ arcs, toolUsage, uniqueTools, summaries }: ToolsPanelProps) {
  if (arcs.length === 0 && toolUsage.length === 0) {
    return (
      <div className={styles.vizPanel} role="tabpanel" id="panel-tools">
        <p className={styles.emptyHint}>No tools connected yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-tools">
      <div className={styles.toolsViz}>
        {/* Ring chart */}
        {arcs.length > 0 && (
          <div className={styles.ringWrap}>
            <svg viewBox="0 0 260 260" className={styles.ringSvg}>
              {arcs.map((arc) => {
                const meta = getToolMeta(arc.tool);
                return (
                  <g key={arc.tool}>
                    <path
                      d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={SW}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                    <line
                      x1={arc.anchorX}
                      y1={arc.anchorY}
                      x2={arc.labelX}
                      y2={arc.labelY}
                      stroke="var(--faint)"
                      strokeWidth="1"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={arc.labelX}
                      y={arc.labelY - 4}
                      textAnchor={arc.side === 'right' ? 'start' : 'end'}
                      fill={meta.color}
                      fontSize="16"
                      fontWeight="400"
                      fontFamily="var(--display)"
                      letterSpacing="-0.04em"
                    >
                      {Math.round(arc.share * 100)}%
                    </text>
                    <text
                      x={arc.labelX}
                      y={arc.labelY + 10}
                      textAnchor={arc.side === 'right' ? 'start' : 'end'}
                      fill="var(--muted)"
                      fontSize="9"
                      fontFamily="var(--sans)"
                      fontWeight="500"
                    >
                      {meta.label}
                    </text>
                  </g>
                );
              })}
              <text
                x={CX}
                y={CY - 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--ink)"
                fontSize="28"
                fontWeight="200"
                fontFamily="var(--display)"
                letterSpacing="-0.06em"
              >
                {uniqueTools}
              </text>
              <text
                x={CX}
                y={CY + 16}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="8.5"
                fontFamily="var(--mono)"
                letterSpacing="0.1em"
              >
                TOOLS
              </text>
            </svg>
          </div>
        )}

        {/* Legend table */}
        {toolUsage.length > 0 && (
          <div className={styles.toolsLegend}>
            {toolUsage.map((entry) => {
              const meta = getToolMeta(entry.tool);
              const projects = summaries
                .filter((t) => (t.hosts_configured || []).some((tc) => tc.host_tool === entry.tool))
                .map((t) => t.team_name || t.team_id);
              return (
                <div key={entry.tool} className={styles.legendRow}>
                  <span className={styles.legendDot} style={{ background: meta.color }} />
                  <span className={styles.legendName}>{meta.label}</span>
                  <span className={styles.legendProjects}>{projects.join(', ')}</span>
                  <span className={styles.legendShare}>{Math.round(entry.share * 100)}%</span>
                  <span className={styles.legendSessions}>
                    {entry.joins} session{entry.joins === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
