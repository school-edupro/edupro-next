'use client';
import { Button, Switch } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type KeyboardEvent } from 'react';
import {
  AUDIENCE_LABEL,
  DAILY_LIMIT,
  MAX_STARTERS,
  SETUP_AUDIENCES,
  editableValues,
  sameValues,
  setupProblems,
  whenChanged,
  type AssistantSetup,
  type AssistantSetupValues,
  type SetupAudience,
} from '@/lib/assistant-setup';
import { saveAssistantSetup } from './actions';

const AUDIENCE_HELP: Record<SetupAudience, string> = {
  student: 'Only when a parent gave the AI assistant consent.',
  parent: 'About their own children, once they gave the AI assistant consent.',
  teacher: 'About their own sections and their own records.',
  admin: 'School-wide answers by their rights (principal, office, accounts …).',
};

/** One audience's starter questions: in order (move up / down, remove), "Add" from its questions not chosen yet. */
function StarterList({
  audience,
  items,
  standard,
  options,
  canEdit,
  onChange,
}: {
  audience: SetupAudience;
  items: string[];
  standard: string[];
  options: Array<{ id: string; ask: string }>;
  canEdit: boolean;
  onChange: (next: string[]) => void;
}) {
  const askOf = useMemo(() => new Map(options.map((o) => [o.id, o.ask])), [options]);
  const free = options.filter((o) => !items.includes(o.id));
  const move = (i: number, j: number) => {
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const id = `as-starters-${audience}`;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <p className="ep-field__help" style={{ margin: 0 }}>
        {items.length
          ? `${String(items.length)} of at most ${String(MAX_STARTERS)}, in this order.`
          : 'Empty: the standard ones.'}
      </p>
      {items.length === 0 ? (
        <ol
          data-testid={`${id}-standard`}
          className="ep-field__help"
          style={{ margin: 0, paddingLeft: '1.2em' }}
        >
          {standard.map((s) => (
            <li key={s}>{askOf.get(s) ?? s}</li>
          ))}
        </ol>
      ) : (
        <ol
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-1)' }}
        >
          {items.map((key, i) => {
            const label = askOf.get(key) ?? key;
            return (
              <li
                key={key}
                data-testid={`${id}-row`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  padding: 'var(--sp-2) var(--sp-3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-card)',
                }}
              >
                <span className="ep-field__help" style={{ margin: 0, minWidth: '1.5rem' }}>
                  {String(i + 1)}.
                </span>
                <strong style={{ flex: '1 1 12rem' }}>{label}</strong>
                {canEdit ? (
                  <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      aria-label={`Move ${label} up`}
                      onClick={() => move(i, i - 1)}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={i === items.length - 1}
                      aria-label={`Move ${label} down`}
                      onClick={() => move(i, i + 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${label}`}
                      onClick={() => onChange(items.filter((x) => x !== key))}
                    >
                      Remove
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {canEdit ? (
        <div
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <div className="ep-field" style={{ flex: '1 1 18rem', marginBottom: 0 }}>
            <label className="ep-field__label" htmlFor={`${id}-add`}>
              Add a starter question
            </label>
            <select
              id={`${id}-add`}
              className="ep-select"
              value=""
              disabled={items.length >= MAX_STARTERS || free.length === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (v && !items.includes(v)) onChange([...items, v]);
              }}
            >
              <option value="">
                {items.length >= MAX_STARTERS
                  ? `Full (${String(MAX_STARTERS)})`
                  : 'Choose a question…'}
              </option>
              {free.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.ask}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={items.length === 0}
            onClick={() => onChange([])}
          >
            Use the standard ones
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Assistant set-up editor (docs/design/91 phase C): who may use it, questions a day, topics per audience, starter
 * questions per audience; Save, with the API's words for anything wrong; leaving with unsaved changes asks first.
 */
export function AssistantSetupEditor({
  initial,
  canEdit,
}: {
  initial: AssistantSetup;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(initial);
  const saved = useMemo(() => editableValues(setup), [setup]);
  const [values, setValues] = useState<AssistantSetupValues>(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [tab, setTab] = useState<SetupAudience>('student');
  /** Starter-question tabs: arrow keys, Home and End move between audiences (WAI-ARIA tabs). */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SETUP_AUDIENCES.indexOf(tab);
    const n = SETUP_AUDIENCES.length;
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = SETUP_AUDIENCES[to]!;
    setTab(next);
    document.getElementById(`as-tab-${next}`)?.focus();
  };
  const dirty = !sameValues(values, saved);
  const problems = setupProblems(values);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (next: Partial<AssistantSetupValues>) => {
    setMsg(null);
    setValues({ ...values, ...next });
  };
  const toggleTopic = (a: SetupAudience, topic: string, answered: boolean) =>
    change({
      topicsOff: {
        ...values.topicsOff,
        [a]: answered
          ? values.topicsOff[a].filter((t) => t !== topic)
          : [...values.topicsOff[a], topic],
      },
    });
  const save = () =>
    start(async () => {
      const r = await saveAssistantSetup(values);
      if (r.ok) {
        setSetup(r.data);
        setValues(editableValues(r.data));
        setMsg({ ok: true, text: 'Saved. The chatbot uses this set-up from the next question.' });
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });

  return (
    <>
      <div
        className="ep-card"
        role="status"
        aria-live="polite"
        style={{ marginBottom: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-1)' }}
      >
        <span data-testid="as-changed">
          {setup.updatedAt
            ? `Last changed${setup.updatedBy ? ` by ${setup.updatedBy}` : ''} on ${whenChanged(setup.updatedAt)}.`
            : 'Not changed yet: everyone on, 30 questions a day, every topic, the standard starter questions.'}
        </span>
        {dirty ? <strong data-testid="as-unsaved">You have changes not saved yet.</strong> : null}
      </div>
      {msg ? (
        <div
          className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
          role={msg.ok ? 'status' : 'alert'}
          data-testid="as-msg"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {msg.text}
        </div>
      ) : null}
      {problems.length ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          data-testid="as-problems"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section
        className="ep-card"
        aria-labelledby="as-who-h"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="as-who-h" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Who may use it
        </h2>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          {SETUP_AUDIENCES.map((a) => (
            <Switch
              key={a}
              id={`as-on-${a}`}
              label={AUDIENCE_LABEL[a]}
              help={AUDIENCE_HELP[a]}
              checked={values.audiences[a]}
              disabled={!canEdit}
              onChange={(on) => change({ audiences: { ...values.audiences, [a]: on } })}
            />
          ))}
        </div>
      </section>

      <section
        className="ep-card"
        aria-labelledby="as-limit-h"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="as-limit-h" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Questions a day
        </h2>
        <div className="ep-field" style={{ maxWidth: '16rem', marginBottom: 0 }}>
          <label className="ep-field__label" htmlFor="as-daily-limit">
            Questions a person may ask a day
          </label>
          <input
            id="as-daily-limit"
            className="ep-input"
            type="number"
            inputMode="numeric"
            min={DAILY_LIMIT.min}
            max={DAILY_LIMIT.max}
            step={1}
            value={Number.isFinite(values.dailyLimit) ? values.dailyLimit : ''}
            disabled={!canEdit}
            aria-describedby="as-daily-limit-help"
            onChange={(e) => change({ dailyLimit: Number.parseInt(e.target.value, 10) })}
          />
          <span id="as-daily-limit-help" className="ep-field__help">
            1 to 500; the standard is {String(setup.defaults.dailyLimit)}.
          </span>
        </div>
      </section>

      <section
        className="ep-card"
        aria-labelledby="as-topics-h"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="as-topics-h" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Topics
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Ticked: the chatbot answers about it for that audience. Unticked: switched off, and its
          starter questions are left out.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="ep-table" data-testid="as-topics">
            <caption className="ep-sr-only">Topics answered for each audience</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                {SETUP_AUDIENCES.map((a) => (
                  <th key={a} scope="col">
                    {AUDIENCE_LABEL[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {setup.topics.map((t) => (
                <tr key={t.key}>
                  <th scope="row" style={{ fontWeight: 'var(--fw-regular)' }}>
                    {t.label}
                    <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                      {t.labelHi}
                    </span>
                  </th>
                  {SETUP_AUDIENCES.map((a) => {
                    const none = !setup.catalogue[a].some((e) => e.department === t.key);
                    return (
                      <td key={a}>
                        {none ? (
                          <span className="ep-field__help" style={{ margin: 0 }}>
                            —
                          </span>
                        ) : (
                          <label className="ep-check" htmlFor={`as-topic-${a}-${t.key}`}>
                            <input
                              id={`as-topic-${a}-${t.key}`}
                              type="checkbox"
                              className="ep-check__input"
                              checked={!values.topicsOff[a].includes(t.key)}
                              disabled={!canEdit}
                              onChange={(e) => toggleTopic(a, t.key, e.target.checked)}
                            />
                            <span className="ep-check__box" aria-hidden="true" />
                            <span className="ep-sr-only">{`${t.label} for ${AUDIENCE_LABEL[a]}`}</span>
                          </label>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="ep-card"
        aria-labelledby="as-starters-h"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="as-starters-h" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Starter questions
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The chips on the chat&apos;s start screen, in order (up to {String(MAX_STARTERS)}). A
          question about a topic switched off, or one a person may not ask, is left out for them.
        </p>
        <div
          role="tablist"
          aria-label="Starter questions of each audience"
          className="ep-tabs__list"
        >
          {SETUP_AUDIENCES.map((a) => (
            <button
              key={a}
              id={`as-tab-${a}`}
              role="tab"
              type="button"
              aria-selected={a === tab}
              aria-controls={`as-panel-${a}`}
              tabIndex={a === tab ? 0 : -1}
              className="ep-tabs__tab"
              onClick={() => setTab(a)}
              onKeyDown={onTabKey}
            >
              {AUDIENCE_LABEL[a]}
              {values.starters[a].length ? ` (${String(values.starters[a].length)})` : ''}
            </button>
          ))}
        </div>
        {SETUP_AUDIENCES.map((a) => (
          <div
            key={a}
            id={`as-panel-${a}`}
            role="tabpanel"
            aria-labelledby={`as-tab-${a}`}
            hidden={a !== tab}
            tabIndex={0}
          >
            {a === tab ? (
              <StarterList
                audience={a}
                items={values.starters[a]}
                standard={setup.defaults.starters[a]}
                options={setup.catalogue[a]}
                canEdit={canEdit}
                onChange={(next) => change({ starters: { ...values.starters, [a]: next } })}
              />
            ) : null}
          </div>
        ))}
      </section>

      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <Button
            type="button"
            onClick={save}
            disabled={busy || !dirty || problems.length > 0}
            data-testid="as-save"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValues(saved);
                setMsg(null);
              }}
            >
              Undo my changes
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
