'use client';
import { useActionState, useState, useTransition } from 'react';
import {
  saveAiModel,
  testAiModel,
  type AiModelSettings,
  type SaveState,
  type TestResult,
} from './actions';

const SAMPLE = 'Explain Python decorators in 2 lines';
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/**
 * The AI model for all schools (docs/design/101): its address, token (typed once; afterwards an empty box keeps it),
 * where the answer sits in its reply, a time limit and on / off — then a test: a prompt sent to the saved model, its
 * answer, the status and the time, the raw reply folded.
 */
export function AiModelPanel({ settings }: { settings: AiModelSettings | null }) {
  const [state, save, saving] = useActionState<SaveState, FormData>(saveAiModel, null);
  return (
    <>
      <form action={save} className="ep-form-section__body" aria-label="AI model for all schools">
        {state ? (
          <p
            className={`ep-alert ${state.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
            role={state.ok ? 'status' : 'alert'}
            data-testid="aim-msg"
          >
            {state.message}
          </p>
        ) : null}
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
          }}
        >
          <label className="ep-field" htmlFor="aim-url" style={{ gridColumn: '1 / -1' }}>
            <span className="ep-field__label">Address (URL) *</span>
            <input
              className="ep-input"
              id="aim-url"
              name="url"
              type="url"
              required
              maxLength={500}
              defaultValue={settings?.url ?? ''}
              placeholder="http://localhost:8080/v1/chat"
              aria-describedby="aim-url-help"
              autoComplete="off"
            />
            <span className="ep-field__help" id="aim-url-help">
              EduPro sends <code>{'{"prompt": "…"}'}</code> to this address with the token as
              “Authorization: Bearer”.
            </span>
          </label>
          <label className="ep-field" htmlFor="aim-token">
            <span className="ep-field__label">Bearer token{settings ? '' : ' *'}</span>
            <input
              className="ep-input"
              id="aim-token"
              name="token"
              type="password"
              required={!settings}
              maxLength={4000}
              placeholder={settings ? `Saved ••••${settings.tokenLast4} (leave empty to keep)` : ''}
              autoComplete="new-password"
              aria-describedby="aim-token-help"
            />
            <span className="ep-field__help" id="aim-token-help">
              Kept encrypted; never shown again{settings ? ` (ends ${settings.tokenLast4})` : ''}.
            </span>
          </label>
          <label className="ep-field" htmlFor="aim-field">
            <span className="ep-field__label">Reply field (optional)</span>
            <input
              className="ep-input"
              id="aim-field"
              name="replyField"
              maxLength={120}
              defaultValue={settings?.replyField ?? ''}
              placeholder="found automatically"
              aria-describedby="aim-field-help"
              autoComplete="off"
            />
            <span className="ep-field__help" id="aim-field-help">
              Where the answer sits in the model’s JSON reply, such as <code>response</code>,{' '}
              <code>data.reply</code> or <code>choices[0].message.content</code>. Empty: EduPro
              finds it.
            </span>
          </label>
          <label className="ep-field" htmlFor="aim-operator" style={{ gridColumn: '1 / -1' }}>
            <span className="ep-field__label">Who runs the model (optional)</span>
            <input
              className="ep-input"
              id="aim-operator"
              name="operator"
              maxLength={120}
              defaultValue={settings?.operator ?? ''}
              placeholder="the organisation's name"
              aria-describedby="aim-operator-help"
              autoComplete="organization"
            />
            <span className="ep-field__help" id="aim-operator-help">
              Parents see this name when the app asks them to allow the AI model&apos;s help;
              parents and students get that help only once it is named and they agree. Changing it
              asks them again.
            </span>
          </label>
          <label className="ep-field" htmlFor="aim-timeout">
            <span className="ep-field__label">Wait for an answer, at most (seconds)</span>
            <input
              className="ep-input"
              id="aim-timeout"
              name="timeoutSeconds"
              type="number"
              min={5}
              max={120}
              required
              defaultValue={settings?.timeoutSeconds ?? 30}
            />
          </label>
        </div>
        <label className="ep-check" htmlFor="aim-on">
          <input
            id="aim-on"
            name="on"
            type="checkbox"
            className="ep-check__input"
            defaultChecked={settings?.on ?? false}
            aria-describedby="aim-on-help"
          />
          <span className="ep-check__box" />
          On for all schools
        </label>
        <span className="ep-field__help" id="aim-on-help" style={{ marginTop: 0 }}>
          When on, it helps the assistant (instead of Claude) and writes the AI reports — in each
          school only after that school switches it on.
        </span>
        <div className="ep-form-actions">
          <button type="submit" className="ep-btn ep-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save for all schools'}
          </button>
        </div>
        {settings ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Last changed {when(settings.updatedAt)}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.
          </p>
        ) : null}
      </form>
      {settings ? <AiModelTest lastTest={settings.lastTest} /> : null}
    </>
  );
}

function AiModelTest({ lastTest }: { lastTest: AiModelSettings['lastTest'] }) {
  const [prompt, setPrompt] = useState(SAMPLE);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError(null);
      const r = await testAiModel(prompt.trim());
      if ('error' in r) {
        setResult(null);
        setError(r.error);
      } else setResult(r.result);
    });
  return (
    <section
      aria-labelledby="aim-test-h"
      style={{ marginTop: 'var(--sp-5)', borderTop: '1px solid var(--border-subtle)' }}
      data-testid="aim-test"
    >
      <h3 id="aim-test-h" className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
        Test the saved model
      </h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Sends one prompt to the saved address with the saved token (on or off) and shows what came
        back.
        {lastTest
          ? ` Last test ${when(lastTest.at)}: ${lastTest.note ?? (lastTest.ok ? 'answered' : 'failed')}.`
          : ''}
      </p>
      <label className="ep-field" htmlFor="aim-prompt">
        <span className="ep-field__label">Prompt</span>
        <textarea
          className="ep-input"
          id="aim-prompt"
          rows={3}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="ep-form-actions">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          onClick={send}
          disabled={pending || !prompt.trim()}
          data-testid="aim-send"
        >
          {pending ? 'Waiting for the model…' : 'Send'}
        </button>
      </div>
      <div aria-live="polite" data-testid="aim-result">
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <p
              className={`ep-alert ${result.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
              role={result.ok ? 'status' : 'alert'}
            >
              {result.ok ? 'The model answered.' : (result.problem ?? 'No answer.')}{' '}
              {[
                result.status === null ? null : `HTTP ${String(result.status)}`,
                `${String(result.ms)} ms`,
                result.field ? `the answer from ${result.field}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {result.reply ? (
              <div>
                <span className="ep-field__label">Answer</span>
                <p style={{ whiteSpace: 'pre-wrap', margin: 'var(--sp-1) 0 0' }}>{result.reply}</p>
              </div>
            ) : null}
            {result.raw ? (
              <details className="ep-fold">
                <summary>The raw reply ({String(result.raw.length)} characters)</summary>
                <pre
                  tabIndex={0}
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '20rem',
                    overflow: 'auto',
                    margin: 'var(--sp-2) 0 0',
                  }}
                >
                  {result.raw}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
