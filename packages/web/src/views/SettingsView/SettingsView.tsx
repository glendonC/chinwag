import { useState, type KeyboardEvent, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import { COLOR_PALETTE, getColorHex } from '../../lib/utils.js';
import { useTheme } from '../../lib/useTheme.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import styles from './SettingsView.module.css';

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const GITHUB_REDIRECT_HOSTS = new Set(['github.com', 'www.github.com']);
const THEME_OPTIONS = ['system', 'light', 'dark'] as const;
type ThemePreference = (typeof THEME_OPTIONS)[number];

// ── Budget presets ──
// Users pick a semantic context level rather than twiddling raw numbers.
// The mapping lives here (the only place in the UI that knows the magnitudes).
// If someone edits `~/.chinmeister/config.json` or `.chinmeister` to an off-preset
// combination we show no preset as active rather than lying about which one
// matches — the MCP still honors the concrete values either way.
const BUDGET_DEFAULTS = {
  memoryResultCap: 20,
  memoryContentTruncation: 500,
  coordinationBroadcast: 'full' as const,
};

type ContextPreset = 'lean' | 'balanced' | 'rich';
const CONTEXT_PRESETS: Array<{
  id: ContextPreset;
  label: string;
  description: string;
  memoryResultCap: number;
  memoryContentTruncation: number;
}> = [
  {
    id: 'lean',
    label: 'Lean',
    description: 'Tighter pulls, lower token cost. Best for focused tasks.',
    memoryResultCap: 5,
    memoryContentTruncation: 100,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Moderate depth. The default that fits most sessions.',
    memoryResultCap: 10,
    memoryContentTruncation: 500,
  },
  {
    id: 'rich',
    label: 'Rich',
    description: 'Deepest context. Full memory text, highest token cost.',
    memoryResultCap: 20,
    memoryContentTruncation: 0,
  },
];

const BROADCAST_OPTIONS: Array<{ value: 'full' | 'silent'; label: string; description: string }> = [
  {
    value: 'full',
    label: 'Shared',
    description: 'Your file activity shows up in the team view.',
  },
  {
    value: 'silent',
    label: 'Private',
    description: "Your work stays local. You still see teammates; they don't see you.",
  },
];

type BroadcastMode = (typeof BROADCAST_OPTIONS)[number]['value'];
interface BudgetShape {
  memoryResultCap: number;
  memoryContentTruncation: number;
  coordinationBroadcast: BroadcastMode;
}

/**
 * Extract only the fields the user has actively set. Unset fields stay
 * `undefined` so the UI can distinguish "defaults are showing through"
 * from "the user explicitly picked this value" — which matters for the
 * empty state: we don't want to highlight `Balanced` as the user's choice
 * just because that's what the defaults happen to be.
 */
function readExplicitBudgets(raw: unknown): Partial<BudgetShape> {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<BudgetShape> = {};
  if (typeof obj.memoryResultCap === 'number') out.memoryResultCap = obj.memoryResultCap;
  if (typeof obj.memoryContentTruncation === 'number') {
    out.memoryContentTruncation = obj.memoryContentTruncation;
  }
  if (obj.coordinationBroadcast === 'silent' || obj.coordinationBroadcast === 'full') {
    out.coordinationBroadcast = obj.coordinationBroadcast;
  }
  return out;
}

function resolveBudgets(explicit: Partial<BudgetShape>): BudgetShape {
  return {
    memoryResultCap: explicit.memoryResultCap ?? BUDGET_DEFAULTS.memoryResultCap,
    memoryContentTruncation:
      explicit.memoryContentTruncation ?? BUDGET_DEFAULTS.memoryContentTruncation,
    coordinationBroadcast: explicit.coordinationBroadcast ?? BUDGET_DEFAULTS.coordinationBroadcast,
  };
}

/** Match a pair of explicit values to a preset id. Null for custom combos or unset. */
function matchContextPreset(explicit: Partial<BudgetShape>): ContextPreset | null {
  if (explicit.memoryResultCap === undefined || explicit.memoryContentTruncation === undefined) {
    return null;
  }
  const hit = CONTEXT_PRESETS.find(
    (p) =>
      p.memoryResultCap === explicit.memoryResultCap &&
      p.memoryContentTruncation === explicit.memoryContentTruncation,
  );
  return hit ? hit.id : null;
}

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && GITHUB_REDIRECT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function validateHandleInput(value: string): string | null {
  if (!value) return 'Handle is required.';
  if (value.length < 3 || value.length > 20) return 'Handle must be 3-20 characters.';
  if (!HANDLE_PATTERN.test(value)) return 'Handle may use letters, numbers, and underscores only.';
  return null;
}

function formatDisplayLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface HandleFormState {
  editing: boolean;
  value: string;
  error: string | null;
  saving: boolean;
}

interface ColorFormState {
  saving: boolean;
  error: string | null;
  hovered: string | null;
}

interface Props {}

export default function SettingsView(_props: Props) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [handleForm, setHandleForm] = useState<HandleFormState>({
    editing: false,
    value: '',
    error: null,
    saving: false,
  });
  const [colorForm, setColorForm] = useState<ColorFormState>({
    saving: false,
    error: null,
    hovered: null,
  });
  const [unlinking, setUnlinking] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [savingBudgets, setSavingBudgets] = useState<boolean>(false);
  const { theme, setTheme } = useTheme();

  const previewColorName = colorForm.hovered || user?.color || 'white';
  const previewColor = getColorHex(previewColorName) || '#98989d';

  // Two parallel values: `explicit` is what the user actually saved (for
  // honest active-state rendering); `budgets` merges in defaults so the PUT
  // body is always complete. Never let defaults leak into "what's active."
  const explicitBudgets = readExplicitBudgets(user?.budgets);
  const budgets = resolveBudgets(explicitBudgets);
  const activeContext = matchContextPreset(explicitBudgets);
  const activeBroadcast = explicitBudgets.coordinationBroadcast ?? null;

  async function saveBudgets(next: BudgetShape): Promise<void> {
    if (savingBudgets) return;
    setBudgetError(null);
    setSavingBudgets(true);
    // Optimistic: reflect the choice immediately. The auth store is the single
    // source of truth for rendered state, so reverting on failure is just
    // another updateUser call.
    const previous = user?.budgets ?? null;
    const nextRecord = next as unknown as Record<string, unknown>;
    authActions.updateUser({ budgets: nextRecord });
    try {
      await api('PUT', '/me/budgets', { budgets: nextRecord }, token);
    } catch (err: unknown) {
      authActions.updateUser({ budgets: previous });
      setBudgetError(getErrorMessage(err, 'Could not save budget'));
    } finally {
      setSavingBudgets(false);
    }
  }

  function selectContextPreset(preset: (typeof CONTEXT_PRESETS)[number]): void {
    if (activeContext === preset.id) return;
    void saveBudgets({
      memoryResultCap: preset.memoryResultCap,
      memoryContentTruncation: preset.memoryContentTruncation,
      coordinationBroadcast: budgets.coordinationBroadcast,
    });
  }

  function selectBroadcast(value: BroadcastMode): void {
    if (activeBroadcast === value) return;
    void saveBudgets({ ...budgets, coordinationBroadcast: value });
  }

  function startEditHandle(): void {
    setHandleForm({
      editing: true,
      value: user?.handle || '',
      error: null,
      saving: false,
    });
  }

  async function saveHandle(): Promise<void> {
    const val = handleForm.value.trim();
    if (!val || val === user?.handle) {
      setHandleForm((prev) => ({ ...prev, editing: false }));
      return;
    }
    const validationError = validateHandleInput(val);
    if (validationError) {
      setHandleForm((prev) => ({ ...prev, error: validationError }));
      return;
    }
    setHandleForm((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await api('PUT', '/me/handle', { handle: val }, token);
      authActions.updateUser({ handle: val });
      setHandleForm((prev) => ({ ...prev, editing: false, saving: false }));
    } catch (err: unknown) {
      setHandleForm((prev) => ({
        ...prev,
        error: getErrorMessage(err, 'Update failed'),
        saving: false,
      }));
    }
  }

  function handleHandleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') saveHandle();
    if (e.key === 'Escape') setHandleForm((prev) => ({ ...prev, editing: false }));
  }

  async function selectColor(colorName: string): Promise<void> {
    if (colorName === user?.color || colorForm.saving) return;
    setColorForm((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await api('PUT', '/me/color', { color: colorName }, token);
      authActions.updateUser({ color: colorName });
    } catch (err: unknown) {
      setColorForm((prev) => ({
        ...prev,
        error: getErrorMessage(err, 'Could not update color'),
      }));
    } finally {
      setColorForm((prev) => ({ ...prev, saving: false }));
    }
  }

  async function handleGithubLink(): Promise<void> {
    setLinkError(null);
    try {
      const result = await api<{ url?: string }>('POST', '/auth/github/link', null, token);
      if (typeof result?.url !== 'string' || !isValidRedirectUrl(result.url)) {
        throw new Error('Received an invalid GitHub link response');
      }
      window.location.href = result.url;
    } catch (err: unknown) {
      setLinkError(getErrorMessage(err, 'Could not start GitHub linking'));
    }
  }

  async function handleGithubUnlink(): Promise<void> {
    setUnlinking(true);
    setLinkError(null);
    try {
      await api('PUT', '/me/github', { action: 'unlink' }, token);
      authActions.updateUser({ github_id: null, github_login: null, avatar_url: null });
    } catch (err: unknown) {
      setLinkError(getErrorMessage(err, 'Could not unlink GitHub'));
    } finally {
      setUnlinking(false);
    }
  }

  function handleLogout(): void {
    stopPolling();
    authActions.logout();
  }

  return (
    <div className={styles.page} style={{ '--preview-color': previewColor } as CSSProperties}>
      <ViewHeader eyebrow="Configure" title="Settings" />

      <section className={styles.settingGroup} style={{ '--group-index': 0 } as CSSProperties}>
        <SectionTitle>Identity</SectionTitle>

        {handleForm.editing ? (
          <div className={styles.handleEditor}>
            <input
              className={styles.handleInput}
              value={handleForm.value}
              onChange={(e) => setHandleForm((prev) => ({ ...prev, value: e.target.value }))}
              onKeyDown={handleHandleKeyDown}
              maxLength={20}
              autoFocus
              disabled={handleForm.saving}
              placeholder="3-20 chars"
            />
            {handleForm.error ? <span className={styles.feedback}>{handleForm.error}</span> : null}
            <div className={styles.editorActions}>
              <button
                className={clsx(styles.inlineAction, styles.inlineActionPrimary)}
                onClick={saveHandle}
                disabled={handleForm.saving}
              >
                {handleForm.saving ? 'Saving...' : 'Save'}
              </button>
              <button
                className={styles.inlineAction}
                onClick={() => setHandleForm((prev) => ({ ...prev, editing: false }))}
                disabled={handleForm.saving}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.heroRow}>
            <div className={styles.heroValue}>
              <span className={styles.handleValue}>{user?.handle || 'Unknown user'}</span>
            </div>
            <button
              className={clsx(styles.inlineAction, styles.handleEditButton)}
              onClick={startEditHandle}
              aria-label="Edit handle"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M11.5 1.5l3 3L5 14H2v-3z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Edit</span>
            </button>
          </div>
        )}
      </section>

      <section className={styles.settingGroup} style={{ '--group-index': 1 } as CSSProperties}>
        <SectionTitle>Color</SectionTitle>
        <div className={styles.colorPicker}>
          {COLOR_PALETTE.map((color) => {
            const isCurrent = user?.color === color.name;
            const isPreview = previewColorName === color.name;
            return (
              <button
                key={color.name}
                className={clsx(
                  styles.colorDot,
                  isCurrent && styles.colorDotCurrent,
                  isPreview && styles.colorDotPreview,
                )}
                style={{ '--dot-color': color.hex } as CSSProperties}
                onClick={() => selectColor(color.name)}
                onMouseEnter={() => setColorForm((prev) => ({ ...prev, hovered: color.name }))}
                onMouseLeave={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                onFocus={() => setColorForm((prev) => ({ ...prev, hovered: color.name }))}
                onBlur={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                disabled={colorForm.saving}
                title={color.name}
                aria-label={`Select ${color.name}`}
                aria-pressed={isCurrent}
              />
            );
          })}
        </div>
        {colorForm.error ? <span className={styles.feedback}>{colorForm.error}</span> : null}
      </section>

      <section className={styles.settingGroup} style={{ '--group-index': 2 } as CSSProperties}>
        <SectionTitle>Appearance</SectionTitle>
        <div className={styles.themeToggle}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              className={clsx(styles.themeOption, theme === option && styles.themeOptionActive)}
              onClick={() => setTheme(option as ThemePreference)}
              aria-pressed={theme === option}
            >
              {formatDisplayLabel(option)}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.settingGroup} style={{ '--group-index': 3 } as CSSProperties}>
        <SectionTitle>Agent defaults</SectionTitle>

        <div className={styles.budgetGroup}>
          <span className={styles.budgetLabel}>Memory depth</span>
          <div className={styles.budgetOptionList}>
            {CONTEXT_PRESETS.map((preset) => {
              const active = activeContext === preset.id;
              return (
                <button
                  key={preset.id}
                  className={clsx(styles.budgetOption, active && styles.budgetOptionActive)}
                  onClick={() => selectContextPreset(preset)}
                  aria-pressed={active}
                  disabled={savingBudgets}
                >
                  <span className={styles.budgetOptionName}>{preset.label}</span>
                  <span className={styles.budgetOptionDescription}>{preset.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.budgetGroup}>
          <span className={styles.budgetLabel}>Teammate visibility</span>
          <div className={styles.budgetOptionList}>
            {BROADCAST_OPTIONS.map((option) => {
              const active = activeBroadcast === option.value;
              return (
                <button
                  key={option.value}
                  className={clsx(styles.budgetOption, active && styles.budgetOptionActive)}
                  onClick={() => selectBroadcast(option.value)}
                  aria-pressed={active}
                  disabled={savingBudgets}
                >
                  <span className={styles.budgetOptionName}>{option.label}</span>
                  <span className={styles.budgetOptionDescription}>{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {budgetError ? <span className={styles.feedback}>{budgetError}</span> : null}
      </section>

      <section className={styles.settingGroup} style={{ '--group-index': 4 } as CSSProperties}>
        <SectionTitle>GitHub</SectionTitle>
        {user?.github_login ? (
          <div className={styles.heroRow}>
            <div className={styles.heroValue}>
              <span className={styles.settingValue}>@{user.github_login}</span>
            </div>
            <button
              className={clsx(styles.inlineAction, styles.inlineActionDanger)}
              onClick={handleGithubUnlink}
              disabled={unlinking}
            >
              {unlinking ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button className={styles.githubButton} onClick={handleGithubLink}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Connect GitHub
          </button>
        )}
        {linkError ? <p className={styles.feedback}>{linkError}</p> : null}
      </section>

      <section className={styles.settingGroup} style={{ '--group-index': 5 } as CSSProperties}>
        <SectionTitle>Session</SectionTitle>
        <button className={styles.sessionButton} onClick={handleLogout}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 2.75H3.75v10.5H6"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.25 5.25L12 8m0 0l-3.75 2.75M12 8H5"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Sign out
        </button>
      </section>
    </div>
  );
}
