'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReminderPayload, ReminderPreview, ReminderResult } from '@/lib/fee-reminder-actions';

type Channel = 'sms' | 'whatsapp' | 'email';
const CHANNELS: Array<[Channel, string]> = [
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
];
const TO: Array<[ReminderPayload['to'], string, string]> = [
  ['father', 'Father', 'the father of each pupil'],
  ['mother', 'Mother', 'the mother of each pupil'],
  ['both', 'Both parents', 'father and mother, each their own message'],
  [
    'contact',
    'Contact marked for notices',
    'the one ticked "receives notifications" on the profile',
  ],
];
const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ReminderTemplate {
  id: string;
  code: string;
  channel: Channel;
  name: string | null;
  body: string;
}

/**
 * The fee reminder, laid out as Communication -> Compose: choose the channels and a template for each,
 * who is reached and who is on copy; the right side shows who will get it, the cost and the message as
 * the first parent reads it; a test goes to the sender and those on copy before the real send.
 */
export function ReminderCompose({
  filter,
  templates,
  staff,
  ccDefault,
  back,
  backLabel = 'Back to defaulters',
  amountWord = 'overdue',
  preview,
  test,
  send,
  saveCc,
}: {
  /** The pupils: ticked ones, or everyone the defaulters filters list. */
  filter: Pick<
    ReminderPayload,
    'studentIds' | 'asOf' | 'classId' | 'discountId' | 'minBalance' | 'ledger' | 'misc'
  >;
  /** Where "Back" goes, in words, and what the amount is called (overdue, or to pay for a misc fee). */
  backLabel?: string;
  amountWord?: string;
  templates: ReminderTemplate[];
  staff: Array<{ id: string; name: string; designation: string | null }>;
  ccDefault: string[];
  back: string;
  preview: (p: ReminderPayload) => Promise<ReminderResult<ReminderPreview>>;
  test: (p: ReminderPayload) => Promise<ReminderResult<{ to: string[]; status: string }>>;
  send: (p: ReminderPayload) => Promise<
    ReminderResult<{
      status: string;
      pupils: number;
      parents: number;
      copies: number;
      totalDue: string;
    }>
  >;
  saveCc: (cc: string[]) => Promise<ReminderResult<{ cc: string[] }>>;
}) {
  const byChannel = useMemo(() => {
    const m: Record<Channel, ReminderTemplate[]> = { sms: [], whatsapp: [], email: [] };
    for (const t of templates) m[t.channel].push(t);
    return m;
  }, [templates]);
  const [chosen, setChosen] = useState<Partial<Record<Channel, string>>>({});
  const [to, setTo] = useState<ReminderPayload['to']>('father');
  const [cc, setCc] = useState<string[]>(ccDefault.filter((id) => staff.some((s) => s.id === id)));
  const [add, setAdd] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [again, setAgain] = useState(false);
  const [view, setView] = useState<ReminderPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'test' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<{
    status: string;
    pupils: number;
    parents: number;
    copies: number;
    totalDue: string;
  } | null>(null);

  const channels = CHANNELS.filter(([c]) => chosen[c]).map(([c]) => ({
    channel: c,
    templateId: chosen[c]!,
  }));
  const payload: ReminderPayload = { ...filter, channels, to, cc, variables: values, again };
  const key = JSON.stringify([channels, to, again, values]);

  // the right side follows what is chosen (after a short pause while a value is typed)
  useEffect(() => {
    if (channels.length === 0) {
      setView(null);
      return;
    }
    const t = setTimeout(async () => {
      setBusy('preview');
      const r = await preview(payload);
      setBusy(null);
      if (r.ok) {
        setView(r.data);
        setError(null);
      } else setError(r.error);
    }, 400);
    return () => clearTimeout(t);
    // `key` holds everything the preview depends on
  }, [key]);

  const missing = (view?.message?.askValues ?? []).filter((k) => !(values[k] ?? '').trim());
  const ready = channels.length > 0 && !!view?.message && missing.length === 0;
  const ccPeople = cc.map((id) => staff.find((s) => s.id === id)).filter((x) => !!x);

  if (done)
    return (
      <section className="ep-card" role="status">
        <h2 className="ep-card__title">
          {done.status === 'pending_approval' ? 'Sent for approval' : 'Reminders are on their way'}
        </h2>
        <p>
          {done.parents} parent{done.parents === 1 ? '' : 's'} of {done.pupils} pupil
          {done.pupils === 1 ? '' : 's'}, total {amountWord} {rupees(done.totalDue)}.
          {done.copies > 0 ? ` ${String(done.copies)} on copy.` : ''}
        </p>
        <p className="ep-field__help">
          {done.status === 'pending_approval'
            ? 'The principal approves it from My approvals; it goes out as soon as it is approved.'
            : 'Delivery of each message shows under Communication → Requests.'}
        </p>
        <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <a className="ep-btn ep-btn--primary" href={back}>
            {backLabel}
          </a>
          <a className="ep-btn ep-btn--secondary" href="/comms/requests">
            Open Communication → Requests
          </a>
        </p>
      </section>
    );

  return (
    <div className="ep-compose">
      <div className="ep-compose__main">
        <section className="ep-card" aria-labelledby="r-step1">
          <h2 className="ep-card__title" id="r-step1">
            1. Channels and templates
          </h2>
          <p className="ep-field__help">
            Tick a channel and choose its template. The pupil’s name, class, the amount and what it
            is for go into the template’s blanks for each parent.
          </p>
          <div className="ep-compose__channels">
            {CHANNELS.map(([c, label]) => {
              const list = byChannel[c];
              const on = Boolean(chosen[c]);
              const t = list.find((x) => x.id === chosen[c]);
              return (
                <div key={c} className="ep-compose__channel" data-on={on ? '' : undefined}>
                  <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={list.length === 0}
                      onChange={(e) =>
                        setChosen((s) => {
                          const next = { ...s };
                          if (e.target.checked) next[c] = list[0]!.id;
                          else delete next[c];
                          return next;
                        })
                      }
                    />
                    <strong>{label}</strong>
                  </label>
                  {list.length === 0 ? (
                    <p className="ep-field__help">
                      No active {label} template. Add one under Communication → Templates.
                    </p>
                  ) : on ? (
                    <>
                      <label className="ep-field" htmlFor={`r-tpl-${c}`} style={{ margin: 0 }}>
                        <span className="ep-field__label">{label} template</span>
                        <select
                          id={`r-tpl-${c}`}
                          className="ep-select"
                          value={chosen[c]}
                          onChange={(e) => setChosen((s) => ({ ...s, [c]: e.target.value }))}
                        >
                          {list.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name ?? x.code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="ep-compose__tpl">{t?.body}</p>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ep-card" aria-labelledby="r-step2">
          <h2 className="ep-card__title" id="r-step2">
            2. Who gets it
          </h2>
          <fieldset
            style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--sp-2)' }}
          >
            <legend className="ep-field__label">Send to</legend>
            {TO.map(([value, label, help]) => (
              <label
                key={value}
                style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' }}
              >
                <input
                  type="radio"
                  name="r-to"
                  checked={to === value}
                  onChange={() => setTo(value)}
                />
                <span>
                  <strong>{label}</strong> <span className="ep-field__help">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              marginTop: 'var(--sp-3)',
            }}
          >
            <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
            <span>Also remind those already reminded today on the same channel</span>
          </label>
        </section>

        <section className="ep-card" aria-labelledby="r-step3">
          <h2 className="ep-card__title" id="r-step3">
            3. On copy (seniors)
          </h2>
          <p className="ep-field__help">
            Each person on copy gets the test, then the first reminder once as its parent sees it,
            and an email with the summary of the run (how many parents, total overdue, who sent it).
            Up to 12.
          </p>
          {ccPeople.length > 0 ? (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 'var(--sp-1)',
              }}
            >
              {ccPeople.map((p) => (
                <li
                  key={p!.id}
                  style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                >
                  <span>
                    {p!.name}
                    {p!.designation ? ` · ${p!.designation}` : ''}
                  </span>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Take ${p!.name} off copy`}
                    onClick={() => setCc((s) => s.filter((x) => x !== p!.id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nobody is on copy.</p>
          )}
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            <label className="ep-field" htmlFor="r-cc-add" style={{ margin: 0 }}>
              <span className="ep-field__label">Add a staff member</span>
              <select
                id="r-cc-add"
                className="ep-select"
                value={add}
                onChange={(e) => setAdd(e.target.value)}
              >
                <option value="">Choose…</option>
                {staff
                  .filter((s) => !cc.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.designation ? ` · ${s.designation}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={!add || cc.length >= 12}
              onClick={() => {
                setCc((s) => [...s, add]);
                setAdd('');
              }}
            >
              Add
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={async () => {
                const r = await saveCc(cc);
                setNote(r.ok ? 'Kept as the school’s usual copy list.' : null);
                if (!r.ok) setError(r.error);
              }}
            >
              Keep this as the usual list
            </button>
          </div>
        </section>

        {(view?.message?.askValues ?? []).length > 0 ? (
          <section className="ep-card" aria-labelledby="r-step4">
            <h2 className="ep-card__title" id="r-step4">
              4. Blanks to fill
            </h2>
            <p className="ep-field__help">
              The template has blanks the pupil’s dues do not fill. What you type here goes to every
              parent.
            </p>
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
              }}
            >
              {view!.message!.askValues.map((k) => (
                <label key={k} className="ep-field" htmlFor={`r-v-${k}`} style={{ margin: 0 }}>
                  <span className="ep-field__label">{`{{${k}}}`} *</span>
                  <input
                    id={`r-v-${k}`}
                    className="ep-input"
                    maxLength={500}
                    value={values[k] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="ep-compose__sticky" aria-label="Preview and send">
        <section className="ep-card" aria-busy={busy === 'preview'}>
          <h2 className="ep-card__title">Preview</h2>
          {channels.length === 0 ? (
            <p className="ep-field__help">Tick a channel to see who will be reminded.</p>
          ) : !view ? (
            <p className="ep-field__help">Working it out…</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                <strong>
                  {view.pupils} pupil{view.pupils === 1 ? '' : 's'}
                </strong>{' '}
                of {view.listed} listed · {amountWord} {rupees(view.totalDue)}
              </p>
              {view.remindedToday > 0 ? (
                <p className="ep-field__help">
                  {view.remindedToday} left out: already reminded today on this channel. Tick “Also
                  remind those already reminded today” under step 2 to include them.
                </p>
              ) : null}
              {view.noContact > 0 ? (
                <p className="ep-field__help">
                  {view.noContact} left out: no number or email for the choice above.
                </p>
              ) : null}
              {view.message ? (
                <>
                  <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                    <caption className="ep-sr-only">Messages by channel</caption>
                    <thead>
                      <tr>
                        <th scope="col">Channel</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Messages
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(view.message.byChannel).map(([c, x]) => (
                        <tr key={c}>
                          <td>{CHANNELS.find(([k]) => k === c)?.[1] ?? c}</td>
                          <td style={{ textAlign: 'right' }}>
                            {x.send}
                            {x.skipped ? ` (${String(x.skipped)} skipped)` : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>{rupees(x.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {view.message.switchedOff.length > 0 ? (
                    <p className="ep-alert ep-alert--warning" role="status">
                      Switched off in Communication settings: {view.message.switchedOff.join(', ')}.
                      Those messages will wait.
                    </p>
                  ) : null}
                  {view.message.rendered.map((m) => (
                    <div key={m.channel} style={{ marginTop: 'var(--sp-3)' }}>
                      <div className="ep-kicker">
                        {CHANNELS.find(([k]) => k === m.channel)?.[1] ?? m.channel} · as the first
                        parent reads it
                      </div>
                      {m.subject ? <strong>{m.subject}</strong> : null}
                      <p className="ep-compose__tpl" style={{ color: 'var(--text-body)' }}>
                        {m.text}
                      </p>
                    </div>
                  ))}
                  <p
                    className={
                      view.message.needsApproval ? 'ep-compose__approval' : 'ep-field__help'
                    }
                  >
                    {view.message.needsApproval
                      ? 'Needs the principal’s approval before it goes out.'
                      : 'Goes out straight away (no approval needed).'}
                  </p>
                </>
              ) : (
                <p className="ep-alert ep-alert--warning" role="status">
                  Nobody can be reminded with these choices.
                </p>
              )}
            </>
          )}
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              {error}
            </p>
          ) : null}
          {note ? (
            <p className="ep-field__help" role="status">
              {note}
            </p>
          ) : null}
          {missing.length > 0 ? (
            <p className="ep-field__help">Fill the blanks ({missing.join(', ')}) to send.</p>
          ) : null}
          <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={!ready || busy !== null}
              onClick={async () => {
                setBusy('test');
                setNote(null);
                const r = await test(payload);
                setBusy(null);
                if (r.ok) {
                  setError(null);
                  setNote(`Test sent to ${r.data.to.join(', ')}. Check it before you send.`);
                } else setError(r.error);
              }}
            >
              {busy === 'test'
                ? 'Sending the test…'
                : `Send a test to me${cc.length ? ` and ${String(cc.length)} on copy` : ''}`}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={!ready || busy !== null}
              onClick={async () => {
                setBusy('send');
                const r = await send(payload);
                setBusy(null);
                if (r.ok) setDone(r.data);
                else setError(r.error);
              }}
            >
              {busy === 'send'
                ? 'Sending…'
                : view?.message?.needsApproval
                  ? `Send ${String(view.message.total)} for approval`
                  : `Send to ${String(view?.message?.total ?? 0)} parent${view?.message?.total === 1 ? '' : 's'}`}
            </button>
            <a className="ep-btn ep-btn--ghost" href={back}>
              {backLabel}
            </a>
          </div>
        </section>
      </aside>
    </div>
  );
}
