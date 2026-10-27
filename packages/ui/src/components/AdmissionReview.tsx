'use client';
import { useState, useTransition } from 'react';

/** A level's decision with its remark (docs/design/50). */
export interface ReviewRemark {
  stage: string;
  level: number;
  levels: number;
  levelName: string;
  decision: string;
  remarks: string | null;
  by: string | null;
  at: string;
}
export interface AdmissionReviewData {
  id: string;
  number: string | null;
  candidate: string | null;
  status: string;
  className: string;
  session: string;
  category: string | null;
  categoryId: string | null;
  categories: Array<{ id: string; name: string }>;
  photoFileId: string | null;
  mayDecide: boolean;
  current: {
    name: string;
    kind: string;
    level: number;
    levels: number;
    levelName: string;
  } | null;
  path: Array<{
    stageId: string;
    name: string;
    state: 'done' | 'current' | 'waiting' | 'rejected';
    levels: Array<{
      no: number;
      name: string;
      result: {
        decision: string;
        remarks: string | null;
        by: string | null;
        at: string;
        marks: number | null;
      } | null;
    }>;
  }>;
  points: {
    total: number;
    max?: number | null;
    lines: Array<{
      name: string;
      max: number;
      auto: number;
      points: number;
      reason?: string | null;
      check?: string | null;
    }>;
    confirmedAt: string | null;
    confirmedBy: string | null;
  } | null;
  merit: number | null;
  sections: Array<{ title: string; items: Array<{ label: string; value: string }> }>;
  documents: Array<{
    key: string;
    label: string;
    /** what the approver may put in its place: a photo only, or a photo or PDF */
    accept?: 'image' | 'image_pdf';
    files: Array<{ id: string; name: string; contentType: string }>;
  }>;
  remarks: ReviewRemark[];
  fields: Array<{ key: string; label: string }>;
  /** the answers the approver may change, tab by tab (docs/design/51) */
  edit: Array<{
    title: string;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      options: string[] | null;
      value: string | string[];
    }>;
  }>;
  changes: Array<{
    id: string;
    label: string;
    from: string | null;
    to: string | null;
    reason: string;
    by: string | null;
    at: string;
  }>;
  receipts: Array<{ id: string; receiptNo: string; amount: number; date: string; head: string }>;
  hasForm: boolean;
  /** an admin deciding at a level not theirs: the level and its people (docs/design/55) */
  onBehalf?: string | null;
}
type Result = { ok: true } | { ok: false; error: string };
export interface AdmissionReviewActions {
  decide: (input: { decision: 'approve' | 'hold' | 'reject'; remarks: string }) => Promise<Result>;
  sendBack: (input: { fields: string[]; remark: string; dueOn?: string }) => Promise<Result>;
  correct: (input: { answers: Record<string, unknown>; reason: string }) => Promise<Result>;
  /** put in a document or photo in place of the family's (PDF, PNG, JPEG; 5 MB) */
  replaceDocument?: (fd: FormData) => Promise<Result>;
}

const DECISION: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Not selected',
  hold: 'On hold',
  offered: 'Offered',
  waitlisted: 'Waiting list',
};
const dmy = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

function FileIcons({ view, save, label }: { view: string; save: string; label: string }) {
  return (
    <span className="ep-filelinks">
      <a
        href={view}
        target="_blank"
        rel="noopener noreferrer"
        className="ep-filelinks__btn"
        aria-label={`View: ${label}`}
        title={`View: ${label}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      </a>
      <a
        href={save}
        className="ep-filelinks__btn"
        download
        aria-label={`Download: ${label}`}
        title={`Download: ${label}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </span>
  );
}

type Field = AdmissionReviewData['edit'][number]['fields'][number];

/** One answer as an input of the form's own kind (docs/design/51). */
function AnswerInput({
  f,
  value,
  onChange,
}: {
  f: Field;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const text = Array.isArray(value) ? value.join(', ') : value;
  if (f.type === 'select' || f.type === 'radio' || f.type === 'yesno') {
    const options = f.type === 'yesno' ? ['Yes', 'No'] : (f.options ?? []);
    return (
      <select
        className="ep-select"
        aria-label={f.label}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {text && !options.includes(text) ? <option value={text}>{text}</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === 'checkbox' && f.options?.length) {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <span className="ep-arv__ticks">
        {f.options.map((o) => (
          <label key={o} className="ep-check">
            <input
              type="checkbox"
              checked={list.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))
              }
            />
            <span>{o}</span>
          </label>
        ))}
      </span>
    );
  }
  if (f.type === 'textarea')
    return (
      <textarea
        className="ep-input"
        rows={3}
        aria-label={f.label}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <input
      className="ep-input"
      aria-label={f.label}
      type={
        f.type === 'date'
          ? 'date'
          : f.type === 'email'
            ? 'email'
            : f.type === 'number'
              ? 'number'
              : f.type === 'mobile'
                ? 'tel'
                : 'text'
      }
      value={text}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The review of a registration waiting at an approver's level (docs/design/50, 51), the same in the
 * admin and the staff app: the candidate, the points (worked out from the answers), the registration
 * form and receipts, the documents, the answers by tab (editable, with a reason), the stage path with
 * every level's remark, and the decision with its remark.
 */
export function AdmissionReview({
  data,
  baseUrl,
  backHref,
  actions,
}: {
  data: AdmissionReviewData;
  /**
   * where this registration's files are served: `${baseUrl}/files/<id>`, `${baseUrl}/form`,
   * `${baseUrl}/receipts/<id>` (?download=1 saves a copy)
   */
  baseUrl: string;
  backHref: string;
  actions: AdmissionReviewActions;
}) {
  const [remarks, setRemarks] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [mode, setMode] = useState<'decide' | 'send'>('decide');
  const [fields, setFields] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(data.edit.flatMap((t) => t.fields.map((f) => [f.key, f.value]))),
  );
  const [why, setWhy] = useState('');
  const [noPhoto, setNoPhoto] = useState(false);
  const [swap, setSwap] = useState<string | null>(null);
  const [swapFile, setSwapFile] = useState<File | null>(null);
  const [swapWhy, setSwapWhy] = useState('');
  const [pending, start] = useTransition();
  const url = (path: string, download?: boolean) =>
    `${baseUrl}/${path}${download ? '?download=1' : ''}`;
  const original = new Map(data.edit.flatMap((t) => t.fields.map((f) => [f.key, f])));
  const changedKeys = [...original.keys()].filter(
    (k) => JSON.stringify(answers[k] ?? '') !== JSON.stringify(original.get(k)!.value),
  );

  const decide = (decision: 'approve' | 'hold' | 'reject') =>
    start(async () => {
      if (remarks.trim().length < 3) {
        setMsg({ tone: 'danger', text: 'Write a remark first (at least 3 letters).' });
        return;
      }
      const r = await actions.decide({ decision, remarks: remarks.trim() });
      if (r.ok) window.location.assign(`${backHref}?ok=${decision}`);
      else setMsg({ tone: 'danger', text: r.error });
    });
  const sendBack = () =>
    start(async () => {
      if (!fields.length || remarks.trim().length < 3) {
        setMsg({ tone: 'danger', text: 'Tick what the family must correct and write the remark.' });
        return;
      }
      const r = await actions.sendBack({
        fields,
        remark: remarks.trim(),
        ...(dueOn ? { dueOn } : {}),
      });
      if (r.ok) window.location.assign(`${backHref}?ok=sent-back`);
      else setMsg({ tone: 'danger', text: r.error });
    });
  const saveAnswers = () =>
    start(async () => {
      if (!changedKeys.length) {
        setMsg({ tone: 'danger', text: 'Nothing has changed yet.' });
        return;
      }
      if (why.trim().length < 3) {
        setMsg({ tone: 'danger', text: 'Give the reason for the change.' });
        return;
      }
      const out: Record<string, unknown> = {};
      for (const k of changedKeys) {
        const f = original.get(k)!;
        const v = answers[k];
        out[k] = f.type === 'yesno' ? v === 'Yes' : f.type === 'number' && v !== '' ? Number(v) : v;
      }
      const r = await actions.correct({ answers: out, reason: why.trim() });
      if (r.ok) window.location.reload();
      else setMsg({ tone: 'danger', text: r.error });
    });

  const replaceDoc = (key: string, accept: 'image' | 'image_pdf') =>
    start(async () => {
      if (!actions.replaceDocument) return;
      if (!swapFile) {
        setMsg({ tone: 'danger', text: 'Choose the file to put in.' });
        return;
      }
      const okType =
        swapFile.type === 'image/jpeg' ||
        swapFile.type === 'image/png' ||
        (accept === 'image_pdf' && swapFile.type === 'application/pdf');
      if (!okType) {
        setMsg({
          tone: 'danger',
          text:
            accept === 'image'
              ? 'Choose a photo (JPEG or PNG).'
              : 'Choose a PDF, JPEG or PNG file.',
        });
        return;
      }
      if (swapFile.size > 5 * 1024 * 1024) {
        setMsg({ tone: 'danger', text: 'Choose a file of at most 5 MB.' });
        return;
      }
      if (swapWhy.trim().length < 3) {
        setMsg({ tone: 'danger', text: 'Give the reason for the change.' });
        return;
      }
      const fd = new FormData();
      fd.set('key', key);
      fd.set('reason', swapWhy.trim());
      fd.set('file', swapFile);
      const r = await actions.replaceDocument(fd);
      if (r.ok) window.location.reload();
      else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <div className="ep-arv">
      <section className="ep-card ep-arv__head" aria-label="Candidate">
        {data.photoFileId && !noPhoto ? (
          <img
            className="ep-arv__photo"
            src={url(`files/${data.photoFileId}`)}
            alt=""
            onError={() => setNoPhoto(true)}
          />
        ) : (
          <span className="ep-arv__photo" aria-hidden="true" />
        )}
        <div>
          <h2 className="ep-arv__name">{data.candidate ?? 'Candidate'}</h2>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {[data.number, data.className, data.session, data.category].filter(Boolean).join(' · ')}
          </p>
          {data.current ? (
            <p style={{ margin: 'var(--sp-1) 0 0' }}>
              Waiting at <strong>{data.current.name}</strong>
              {data.current.levels > 1
                ? ` · ${data.current.levelName} (level ${String(data.current.level)} of ${String(data.current.levels)})`
                : ''}
            </p>
          ) : null}
        </div>
        <div className="ep-arv__score">
          <span className="ep-field__help">Merit points</span>
          <strong>
            {data.points ? data.points.total : '-'}
            {data.points?.max ? <small> / {data.points.max}</small> : null}
          </strong>
        </div>
      </section>

      {!data.mayDecide ? (
        <p className="ep-alert ep-alert--info" role="status">
          You decided this registration, or it no longer waits at your level: you can read it, not
          change it.
        </p>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}

      <div className="ep-arv__cols">
        <div className="ep-arv__main">
          {data.points ? (
            <section className="ep-card" aria-labelledby="arv-points">
              <h3 id="arv-points" className="ep-arv__h">
                Merit points
              </h3>
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Merit points by criterion</caption>
                  <thead>
                    <tr>
                      <th scope="col">Criterion</th>
                      <th scope="col">Of</th>
                      <th scope="col">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.points.lines.map((l) => (
                      <tr key={l.name}>
                        <td>
                          {l.name}
                          {l.check ? <span className="ep-arv__check">Check: {l.check}</span> : null}
                          {l.reason ? (
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              Awarded by the office: {l.reason}
                            </span>
                          ) : null}
                        </td>
                        <td className="ep-num">{l.max}</td>
                        <td className="ep-num">
                          <strong>{l.points}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ep-field__help" style={{ marginBottom: 0 }}>
                Worked out from the answers: correct an answer below and the points and the fee
                category follow.
                {data.merit !== null ? ` Merit with marks: ${String(data.merit)}.` : ''}
              </p>
            </section>
          ) : null}

          <section className="ep-card" aria-labelledby="arv-docs">
            <h3 id="arv-docs" className="ep-arv__h">
              Registration form, receipts and documents
            </h3>
            <ul className="ep-arv__docs">
              {data.hasForm ? (
                <li>
                  <span>
                    <strong>Registration form</strong>
                  </span>
                  <FileIcons
                    view={url('form')}
                    save={url('form', true)}
                    label="Registration form"
                  />
                </li>
              ) : null}
              {data.receipts.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>Receipt {r.receiptNo}</strong>
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {r.head} · ₹{r.amount.toLocaleString('en-IN')} · {r.date}
                    </span>
                  </span>
                  <FileIcons
                    view={url(`receipts/${r.id}`)}
                    save={url(`receipts/${r.id}`, true)}
                    label={`Receipt ${r.receiptNo}`}
                  />
                </li>
              ))}
              {data.documents.map((d) => (
                <li key={d.key}>
                  <span>{d.label}</span>
                  <span className="ep-arv__docact">
                    {d.files.length ? (
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                        {d.files.map((f, i) => (
                          <FileIcons
                            key={f.id}
                            view={url(`files/${f.id}`)}
                            save={url(`files/${f.id}`, true)}
                            label={`${d.label}${d.files.length > 1 ? ` ${String(i + 1)}` : ''}`}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className="ep-arv__check">Not uploaded</span>
                    )}
                    {data.mayDecide && actions.replaceDocument ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-expanded={swap === d.key}
                        aria-controls={`arv-swap-${d.key}`}
                        onClick={() => {
                          setSwap(swap === d.key ? null : d.key);
                          setSwapFile(null);
                          setSwapWhy('');
                        }}
                      >
                        {d.files.length ? 'Replace' : 'Upload'}
                      </button>
                    ) : null}
                  </span>
                  {swap === d.key ? (
                    <div id={`arv-swap-${d.key}`} className="ep-arv__swap">
                      <label className="ep-field">
                        <span className="ep-field__label">
                          New file for {d.label} (
                          {d.accept === 'image' ? 'JPEG or PNG' : 'PDF, JPEG or PNG'}, up to 5 MB)
                        </span>
                        <input
                          className="ep-input"
                          type="file"
                          accept={
                            d.accept === 'image'
                              ? 'image/jpeg,image/png'
                              : 'application/pdf,image/jpeg,image/png'
                          }
                          onChange={(e) => setSwapFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <label className="ep-field">
                        <span className="ep-field__label">Reason for the change (required)</span>
                        <input
                          className="ep-input"
                          value={swapWhy}
                          maxLength={500}
                          onChange={(e) => setSwapWhy(e.target.value)}
                          placeholder="e.g. The family gave a clearer copy at the desk"
                        />
                      </label>
                      <div className="ep-arv__swapbtns">
                        <button
                          type="button"
                          className="ep-btn ep-btn--primary ep-btn--sm"
                          disabled={pending}
                          onClick={() => replaceDoc(d.key, d.accept ?? 'image_pdf')}
                        >
                          {pending ? 'Saving…' : 'Save the file'}
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          onClick={() => setSwap(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {!data.receipts.length ? (
              <p className="ep-field__help" style={{ marginBottom: 0 }}>
                No payment receipt yet.
              </p>
            ) : null}
          </section>

          <section className="ep-card" aria-labelledby="arv-form">
            <div className="ep-arv__headrow">
              <h3 id="arv-form" className="ep-arv__h">
                The form
              </h3>
              {data.mayDecide && data.edit.length && !editing ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() => setEditing(true)}
                >
                  Edit answers
                </button>
              ) : null}
            </div>
            {editing ? (
              <>
                {data.edit.map((t, i) => (
                  <details key={t.title} className="ep-arv__sec" open={i === 0}>
                    <summary>{t.title}</summary>
                    <div className="ep-arv__edit">
                      {t.fields.map((f) => (
                        <label key={f.key} className="ep-field" style={{ margin: 0 }}>
                          <span className="ep-field__label">
                            {f.label}
                            {f.required ? ' *' : ''}
                            {changedKeys.includes(f.key) ? ' (changed)' : ''}
                          </span>
                          <AnswerInput
                            f={f}
                            value={answers[f.key] ?? ''}
                            onChange={(v) => setAnswers((cur) => ({ ...cur, [f.key]: v }))}
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
                <div className="ep-arv__save">
                  <label className="ep-field" style={{ margin: 0, flex: '1 1 18rem' }}>
                    <span className="ep-field__label">
                      Reason for the change (required) · {changedKeys.length} changed
                    </span>
                    <input
                      className="ep-input"
                      maxLength={500}
                      value={why}
                      onChange={(e) => setWhy(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending}
                    onClick={saveAnswers}
                  >
                    Save the answers
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost"
                    onClick={() => {
                      setEditing(false);
                      setAnswers(
                        Object.fromEntries(
                          data.edit.flatMap((t) => t.fields.map((f) => [f.key, f.value])),
                        ),
                      );
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <p className="ep-field__help" style={{ marginBottom: 0 }}>
                  Documents and photos stay the family&rsquo;s: use Send back to ask for a new one.
                </p>
              </>
            ) : (
              data.sections.map((sct, i) => (
                <details key={sct.title} className="ep-arv__sec" open={i === 0}>
                  <summary>{sct.title}</summary>
                  <dl className="ep-arv__dl">
                    {sct.items.map((x) => (
                      <div key={x.label}>
                        <dt>{x.label}</dt>
                        <dd>{x.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))
            )}
            {data.changes.length ? (
              <div className="ep-arv__changes">
                <h4 className="ep-field__label">Changes to the answers</h4>
                <ul>
                  {data.changes.map((x) => (
                    <li key={x.id}>
                      <strong>{x.label}</strong>: {x.from || '-'} → {x.to || '-'}
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {x.reason} · {x.by ?? ''} · {dmy(x.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="ep-arv__side">
          {data.mayDecide ? (
            <section className="ep-card" aria-labelledby="arv-decide">
              <h3 id="arv-decide" className="ep-arv__h">
                Your decision
              </h3>
              {data.onBehalf ? (
                <p className="ep-alert ep-alert--info" style={{ margin: 0 }}>
                  Deciding for {data.onBehalf}: your remark keeps that it was on their behalf.
                </p>
              ) : null}
              <div role="group" aria-label="What to do" className="ep-arv__modes">
                <button
                  type="button"
                  className={`ep-btn ep-btn--sm ${mode === 'decide' ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
                  aria-pressed={mode === 'decide'}
                  onClick={() => setMode('decide')}
                >
                  Decide
                </button>
                <button
                  type="button"
                  className={`ep-btn ep-btn--sm ${mode === 'send' ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
                  aria-pressed={mode === 'send'}
                  onClick={() => setMode('send')}
                >
                  Send back to the family
                </button>
              </div>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Fee category: <strong>{data.category ?? 'General'}</strong> (from the answers)
              </p>
              {mode === 'send' ? (
                <fieldset className="ep-arv__fields">
                  <legend className="ep-field__label">What must the family correct?</legend>
                  {data.fields.map((f) => (
                    <label key={f.key} className="ep-check">
                      <input
                        type="checkbox"
                        checked={fields.includes(f.key)}
                        onChange={(e) =>
                          setFields((cur) =>
                            e.target.checked ? [...cur, f.key] : cur.filter((x) => x !== f.key),
                          )
                        }
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label className="ep-field">
                <span className="ep-field__label">
                  {mode === 'send' ? 'What to correct, for the family' : 'Your remark'} (required)
                </span>
                <textarea
                  className="ep-input"
                  rows={4}
                  maxLength={1000}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </label>
              {mode === 'send' ? (
                <>
                  <label className="ep-field">
                    <span className="ep-field__label">Correct by (optional)</span>
                    <input
                      className="ep-input"
                      type="date"
                      value={dueOn}
                      onChange={(e) => setDueOn(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending}
                    onClick={sendBack}
                  >
                    Send back
                  </button>
                </>
              ) : (
                <div className="ep-arv__acts">
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending || editing}
                    onClick={() => decide('approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary"
                    disabled={pending || editing}
                    onClick={() => decide('hold')}
                  >
                    Hold
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--danger"
                    disabled={pending || editing}
                    onClick={() => decide('reject')}
                  >
                    Reject
                  </button>
                </div>
              )}
              {editing ? (
                <p className="ep-field__help" style={{ marginBottom: 0 }}>
                  Save or cancel the answers you are changing before deciding.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="ep-card" aria-labelledby="arv-path">
            <h3 id="arv-path" className="ep-arv__h">
              Decisions and remarks
            </h3>
            <ol className="ep-arv__path">
              {data.path.map((st) => (
                <li key={st.stageId} data-state={st.state}>
                  <strong>{st.name}</strong>
                  <ul>
                    {st.levels.map((l) => (
                      <li key={l.no}>
                        <span className="ep-field__help">
                          {st.levels.length > 1 && l.name !== `Level ${String(l.no)}`
                            ? `Level ${String(l.no)} · `
                            : ''}
                          {l.name}
                        </span>
                        {l.result ? (
                          <span className="ep-arv__remark">
                            <strong>{DECISION[l.result.decision] ?? l.result.decision}</strong>
                            {l.result.remarks ? ` — ${l.result.remarks}` : ''}
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              {l.result.by ?? ''} · {dmy(l.result.at)}
                            </span>
                          </span>
                        ) : (
                          <span className="ep-field__help">
                            {st.state === 'current' ? 'Waiting' : '-'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
