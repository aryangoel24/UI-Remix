import { useEffect, useMemo, useState } from 'react';
import { getDomainFromUrl } from '../shared/domain';
import { clearRulesForDomain, deleteRule, getRulesForDomain } from '../shared/storage';
import type { UIRule } from '../shared/types';
import { getActiveTab, sendMessageToActiveTab } from './chromeTabs';

type StatusTone = 'idle' | 'success' | 'warning' | 'error';

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

const DEFAULT_STATUS: StatusMessage = {
  tone: 'idle',
  text: 'Ready'
};

export function App() {
  const [domain, setDomain] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [rules, setRules] = useState<UIRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(DEFAULT_STATUS);

  const ruleCountLabel = useMemo(() => {
    if (rules.length === 1) {
      return '1 rule';
    }

    return `${rules.length} rules`;
  }, [rules.length]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap(): Promise<void> {
    try {
      const tab = await getActiveTab();
      const nextDomain = tab?.url ? getDomainFromUrl(tab.url) : null;
      setDomain(nextDomain);

      if (!nextDomain) {
        setStatus({
          tone: 'warning',
          text: 'Open a regular website tab'
        });
        return;
      }

      const response = await sendMessageToActiveTab({ type: 'UI_REMIX_GET_EDIT_MODE_STATUS' });
      setEditMode(Boolean(response.editMode));
      setStatus(DEFAULT_STATUS);
    } catch (error) {
      setStatus({
        tone: 'warning',
        text: humanizeError(error)
      });
    }
  }

  async function refreshRules(nextDomain = domain): Promise<void> {
    if (!nextDomain) {
      return;
    }

    try {
      setRules(await getRulesForDomain(nextDomain));
    } catch (error) {
      setStatus({
        tone: 'error',
        text: humanizeError(error)
      });
    }
  }

  async function setEditModeState(enabled: boolean): Promise<void> {
    setBusy(true);
    try {
      const response = await sendMessageToActiveTab({
        type: enabled ? 'UI_REMIX_ENABLE_EDIT_MODE' : 'UI_REMIX_DISABLE_EDIT_MODE'
      });
      setEditMode(Boolean(response.editMode));
      setStatus({
        tone: 'success',
        text: enabled ? 'Edit mode enabled' : 'Edit mode disabled'
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: humanizeError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleViewRules(): Promise<void> {
    const nextVisible = !rulesVisible;
    setRulesVisible(nextVisible);

    if (nextVisible) {
      await refreshRules();
    }
  }

  async function handleClearRules(): Promise<void> {
    if (!domain) {
      return;
    }

    setBusy(true);
    try {
      await clearRulesForDomain(domain);
      setRules([]);
      await tryReloadContentRules();
      setStatus({
        tone: 'success',
        text: 'Rules cleared'
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: humanizeError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRule(ruleId: string): Promise<void> {
    setBusy(true);
    try {
      await deleteRule(ruleId);
      setRules((existing) => existing.filter((rule) => rule.id !== ruleId));
      await tryRemoveContentRule(ruleId);
      setStatus({
        tone: 'success',
        text: 'Rule deleted'
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: humanizeError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function tryReloadContentRules(): Promise<void> {
    try {
      await sendMessageToActiveTab({ type: 'UI_REMIX_RELOAD_RULES' });
    } catch {
      // Storage is already updated; restricted or unloaded pages reflect it on refresh.
    }
  }

  async function tryRemoveContentRule(ruleId: string): Promise<void> {
    try {
      await sendMessageToActiveTab({ type: 'UI_REMIX_REMOVE_RULE', ruleId });
    } catch {
      // Deletion persists even when the current tab cannot be messaged.
    }
  }

  const controlsDisabled = busy || !domain;

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div>
          <h1>UI Remix</h1>
          <p>{domain ?? 'Unsupported page'}</p>
        </div>
        <span className={editMode ? 'mode-pill active' : 'mode-pill'}>{editMode ? 'On' : 'Off'}</span>
      </header>

      <section className="control-stack">
        <div className="button-row">
          <button disabled={controlsDisabled || editMode} onClick={() => void setEditModeState(true)}>
            Enable Edit Mode
          </button>
          <button
            className="secondary"
            disabled={controlsDisabled || !editMode}
            onClick={() => void setEditModeState(false)}
          >
            Disable Edit Mode
          </button>
        </div>

        <button className="full secondary" disabled={!domain} onClick={() => void handleViewRules()}>
          {rulesVisible ? 'Hide Rules for This Site' : 'View Rules for This Site'}
        </button>

        <button className="full danger" disabled={controlsDisabled} onClick={() => void handleClearRules()}>
          Clear Rules for This Site
        </button>
      </section>

      <div className={`status ${status.tone}`}>{status.text}</div>

      {rulesVisible ? (
        <section className="rules-panel">
          <div className="rules-header">
            <h2>Saved Rules</h2>
            <span>{ruleCountLabel}</span>
          </div>

          {rules.length > 0 ? (
            <ul className="rule-list">
              {rules.map((rule) => (
                <li key={rule.id} className="rule-card">
                  <div className="rule-topline">
                    <strong>{rule.type}</strong>
                    <time dateTime={rule.createdAt}>{formatDate(rule.createdAt)}</time>
                  </div>
                  <code title={rule.selector}>{rule.selector}</code>
                  <button
                    className="delete-button"
                    disabled={busy}
                    onClick={() => void handleDeleteRule(rule.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">No rules saved for this site.</div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Cannot access') ||
    message.includes('The extensions gallery cannot be scripted') ||
    message.includes('chrome://')
  ) {
    return 'This page does not allow extension scripts';
  }

  if (message.includes('No active tab')) {
    return 'No active tab is available';
  }

  return message || 'Something went wrong';
}
