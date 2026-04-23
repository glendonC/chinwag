// Floating scenario selector for demo mode. Renders a bottom-right pill
// that expands into a vertical scenario list. Visible whenever the URL
// carries ?demo or the build is in dev mode. Writes the selection back
// to the URL via setActiveScenarioId, which broadcasts a custom event
// every analytics/conversation hook listens for.
//
// Design:
// - No card chrome. Surface is the existing --surface-glass backdrop,
//   inheriting the page's backdrop-filter.
// - Hierarchy through font weight + opacity only:
//     active scenario label — weight 500, full ink
//     inactive label        — weight 400, --soft
//     description line      — IBM Plex Mono, --muted
// - Accent blue (--accent) only touches the "active" dot — accent is the
//   live-data color in the rest of the dashboard, and the active scenario
//   dot is the one piece of state this surface reflects about now.

import { useEffect, useRef, useState } from 'react';
import { useDemoScenario } from '../../hooks/useDemoScenario.js';
import { DEMO_SCENARIOS, DEMO_SCENARIO_IDS, type DemoScenarioId } from '../../lib/demo/index.js';
import { isDemoActive, setActiveScenarioId, shouldShowDemoSwitcher } from '../../lib/demoMode.js';
import styles from './DemoSwitcher.module.css';

export default function DemoSwitcher() {
  const { scenarioId } = useDemoScenario();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(() => shouldShowDemoSwitcher());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Visibility is event-driven: toggling ?demo via the URL bar or via
  // setActiveScenarioId should flip the switcher on/off without a reload.
  useEffect(() => {
    function handler() {
      setVisible(shouldShowDemoSwitcher());
    }
    window.addEventListener('chinmeister:demo-scenario-changed', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('chinmeister:demo-scenario-changed', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  // Click-outside closes the panel. Capture phase so widget-grid clicks
  // below don't beat us to it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  if (!visible) return null;

  const active = DEMO_SCENARIOS[scenarioId];
  const activeInUrl = isDemoActive();

  function select(id: DemoScenarioId) {
    setActiveScenarioId(id);
    setOpen(false);
  }

  function exit() {
    setActiveScenarioId(null);
    setOpen(false);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Demo scenarios">
          <div className={styles.panelHead}>
            <span className={styles.panelEyebrow}>demo scenario</span>
            {activeInUrl && (
              <button type="button" className={styles.exitButton} onClick={exit}>
                exit
              </button>
            )}
          </div>
          <ul className={styles.list}>
            {DEMO_SCENARIO_IDS.map((id) => {
              const s = DEMO_SCENARIOS[id];
              const isActive = id === scenarioId && activeInUrl;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                    onClick={() => select(id)}
                  >
                    <span className={styles.dot} aria-hidden="true" />
                    <span className={styles.itemBody}>
                      <span className={styles.itemLabel}>{s.label}</span>
                      <span className={styles.itemDescription}>{s.description}</span>
                    </span>
                    <span className={styles.itemId}>{id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerDot} />
        <span className={styles.triggerLabel}>{active.label}</span>
        <span className={styles.triggerCaret} aria-hidden="true">
          {open ? '↓' : '↑'}
        </span>
      </button>
    </div>
  );
}
