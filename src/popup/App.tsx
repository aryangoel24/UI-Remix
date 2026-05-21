import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getDomainFromUrl } from '../shared/domain';
import { clearRulesForDomain, deleteRule, getRulesForDomain, setRuleEnabled } from '../shared/storage';
import type { CommandRulePreview, UIRule } from '../shared/types';
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
  const [command, setCommand] = useState('');
  const [commandPreview, setCommandPreview] = useState<CommandRulePreview | null>(null);
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
      await loadPendingCommandPreview();
    } catch (error) {
      setStatus({
        tone: 'warning',
        text: humanizeError(error)
      });
    }
  }

  async function loadPendingCommandPreview(): Promise<void> {
    try {
      const response = await sendMessageToActiveTab({ type: 'UI_REMIX_GET_PENDING_COMMAND_PREVIEW' });
      if (response.preview) {
        setCommand(response.preview.command);
        setCommandPreview(response.preview);
        setStatus({
          tone: response.preview.canApply ? 'success' : 'warning',
          text: response.preview.canApply ? 'Manual target ready for review' : 'Manual target still needs review'
        });
      }
    } catch {
      // Older or restricted tabs may not have a pending command preview.
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

  async function handlePreviewCommand(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      setCommandPreview(null);
      setStatus({
        tone: 'error',
        text: 'Type a command first'
      });
      return;
    }

    setBusy(true);
    try {
      const response = await sendMessageToActiveTab({
        type: 'UI_REMIX_PREVIEW_COMMAND',
        command: trimmedCommand
      });

      if (!response.ok || !response.preview) {
        setCommandPreview(null);
        setStatus({
          tone: 'error',
          text: response.error ?? 'Command was unclear'
        });
        return;
      }

      setCommandPreview(response.preview);
      setStatus({
        tone: response.preview.canApply ? 'success' : 'warning',
        text: response.preview.needsElementPick
          ? 'Manual pick active: click the page element'
          : 'Review the proposed rule'
      });
    } catch (error) {
      setCommandPreview(null);
      setStatus({
        tone: 'error',
        text: humanizeError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyCommandRule(): Promise<void> {
    if (!commandPreview) {
      setStatus({
        tone: 'error',
        text: 'Preview a command before applying it'
      });
      return;
    }

    if (!commandPreview.canApply || commandPreview.rules.length === 0) {
      setStatus({
        tone: 'warning',
        text: commandPreview.needsElementPick
          ? 'Manual pick active: click the page element'
          : 'This command is too low confidence to apply'
      });
      return;
    }

    setBusy(true);
    try {
      const response = await sendMessageToActiveTab({
        type: 'UI_REMIX_APPLY_COMMAND_RULES',
        rules: commandPreview.rules.map((item) => item.rule)
      });

      if (!response.ok) {
        setStatus({
          tone: 'error',
          text: response.error ?? 'Could not apply command'
        });
        return;
      }

      if (rulesVisible) {
        await refreshRules();
      }

      setCommand('');
      setCommandPreview(null);
      setStatus({
        tone: 'success',
        text: commandPreview.rules.length === 1 ? 'Command rule applied' : 'Command rules applied'
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

  async function handleToggleRule(rule: UIRule): Promise<void> {
    const nextEnabled = rule.enabled === false;
    setBusy(true);
    try {
      await setRuleEnabled(rule.id, nextEnabled);
      setRules((existing) =>
        existing.map((existingRule) =>
          existingRule.id === rule.id ? { ...existingRule, enabled: nextEnabled } : existingRule
        )
      );
      await tryReloadContentRules();
      setStatus({
        tone: 'success',
        text: nextEnabled ? 'Rule enabled' : 'Rule disabled'
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
  const commandDisabled = busy || !domain;
  const commandSourceLabel = commandPreview ? commandPreview.provider.toUpperCase() : 'AI + LOCAL';

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

      <section className="command-panel">
        <div className="section-heading">
          <h2>Command</h2>
          <span>{commandSourceLabel}</span>
        </div>

        <form className="command-form" onSubmit={(event) => void handlePreviewCommand(event)}>
          <input
            value={command}
            disabled={commandDisabled}
            onChange={(event) => {
              setCommand(event.target.value);
              setCommandPreview(null);
            }}
            placeholder="Hide the sidebar"
            aria-label="Natural language command"
          />
          <button disabled={commandDisabled}>Preview</button>
        </form>

        {commandPreview ? (
          <div className={commandPreview.canApply ? 'preview-card' : 'preview-card blocked'}>
            <div className="preview-topline">
              <strong>{commandPreview.parsed.intent}</strong>
              <span>{commandPreview.provider.toUpperCase()} · {formatConfidence(commandPreview.confidence)}</span>
            </div>
            <p>{commandPreview.summary}</p>

            <dl>
              <div>
                <dt>Intent</dt>
                <dd>{commandPreview.parsed.intent}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{commandPreview.parsed.targetDescription}</dd>
              </div>
              <div>
                <dt>Found</dt>
                <dd>{describeTargets(commandPreview)}</dd>
              </div>
            </dl>

            {commandPreview.needsElementPick ? (
              <div className="manual-pick-note">
                <strong>Manual target required</strong>
                <span>
                  {commandPreview.lowConfidenceReason ??
                    'Click the element you want this command to apply to.'}
                </span>
                <span>After the click, use the in-page Apply/Cancel card.</span>
              </div>
            ) : commandPreview.lowConfidenceReason ? (
              <div className="manual-pick-note">{commandPreview.lowConfidenceReason}</div>
            ) : null}

            {commandPreview.rules.length > 0 ? (
              <ul className="proposal-list">
                {commandPreview.rules.map((item) => (
                  <li key={item.rule.id}>
                    <div className="proposal-head">
                      <strong>{item.rule.type}</strong>
                      <span>{formatConfidence(item.confidence)}</span>
                    </div>
                    <div className="proposal-target">{item.targetLabel}</div>
                    <code title={item.rule.selector}>{item.rule.selector}</code>
                    <div className="proposal-detail">{describeRule(item.rule)}</div>
                  </li>
                ))}
              </ul>
            ) : null}

            {commandPreview.needsElementPick ? (
              <div className="manual-pick-cta">Waiting for a page click</div>
            ) : (
              <button
                className="full apply-command"
                disabled={busy || !commandPreview.canApply}
                onClick={() => void handleApplyCommandRule()}
              >
                {commandPreview.rules.length > 1 ? 'Apply Rules' : 'Apply Rule'}
              </button>
            )}
          </div>
        ) : null}
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
                <li key={rule.id} className={rule.enabled === false ? 'rule-card disabled' : 'rule-card'}>
                  <div className="rule-topline">
                    <strong>{rule.type}</strong>
                    <div className="rule-meta">
                      <span>{rule.enabled === false ? 'Disabled' : 'Enabled'}</span>
                      <time dateTime={rule.createdAt}>{formatDate(rule.createdAt)}</time>
                    </div>
                  </div>
                  <code title={rule.selector}>{rule.selector}</code>
                  <div className="rule-actions">
                    <button
                      className="toggle-rule-button"
                      disabled={busy}
                      onClick={() => void handleToggleRule(rule)}
                    >
                      {rule.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      className="delete-button"
                      disabled={busy}
                      onClick={() => void handleDeleteRule(rule.id)}
                    >
                      Delete
                    </button>
                  </div>
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

function describeTargets(preview: CommandRulePreview): string {
  if (preview.needsElementPick && preview.rules.length === 0) {
    return 'Manual click needed';
  }

  if (preview.rules.length === 0) {
    return 'No target found';
  }

  if (preview.rules.length === 1) {
    const item = preview.rules[0];
    return `${item.targetLabel} (${item.matchCount} match${item.matchCount === 1 ? '' : 'es'})`;
  }

  return `${preview.rules.length} proposed targets`;
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function describeRule(rule: UIRule): string {
  switch (rule.type) {
    case 'hide':
      return 'Set display to none.';
    case 'text':
      return `Set text to "${rule.value}".`;
    case 'style':
      return Object.entries(rule.styles)
        .filter(([, value]) => Boolean(value))
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
    case 'inject':
      return 'Inject rule support is reserved for a future version.';
  }
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
