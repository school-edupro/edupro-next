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
    files: Array<{ id: string; name: string; contentType: string }>;
  }>;
  remarks: ReviewRemark[];
  fields: Array<{ key: string; label: string }>;
}
type Result = { ok: true } | { ok: false; error: string };
export interface AdmissionReviewActions {
  decide: (input: {
    decision: 'approve' | 'hold' | 'reject';
    remarks: string;
    categoryId?: string;
  }) => Promise<Result>;
  sendBack: (input: { fields: string[]; remark: string; dueOn?: string }) => Promise<Result>;
  points: (input: {
    action: 'confirm';
    lines: Array<{ name: string; points: number; reason?: string }>;
  }) => Promise<Result>;
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

/**
 * The review of a registration waiting at an approver's level (docs/design/50), the same in the admin
 * and the staff app: the candidate, the points (awarded differently with a reason), the documents, the
 * answers by tab, the stage path with every level's remark, and the decision with its remark.
 */
export function AdmissionReview({
  data,
  fileBase,
  backHref,
  actions,
}: {
  data: AdmissionReviewData;
  /** where this registration's documents are served: `${fileBase}/<file id>` (?download=1 saves it) */
  fileBase: string;
  backHref: string;
  actions: AdmissionReviewActions;
}) {
  const [remarks, setRemarks] = useState('');
  const [categoryId, setCategoryId] = useState(data.categoryId ?? '');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [mode, setMode] = useState<'decide' | 'send' | 'points'>('decide');
  const [fields, setFields] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [lines, setLines] = useState(
    (data.points?.lines ?? []).map((l) => ({ ...l, reason: l.reason ?? '' })),
  );
  const [pending, start] = useTransition();
  const [noPhoto, setNoPhoto] = useState(false);
  const atDocs = data.current?.kind === 'document_check';
  const fileUrl = (fileId: string, download?: boolean) =>
    `${fileBase}/${fileId}${download ? '?download=1' : ''}`;

  const decide = (decision: 'approve' | 'hold' | 'reject') =>
    start(async () => {
      if (remarks.trim().length < 3) {
        setMsg({ tone: 'danger', text: 'Write a remark first (at least 3 letters).' });
        return;
      }
      const r = await actions.decide({
        decision,
        remarks: remarks.trim(),
        ...(atDocs && categoryId && categoryId !== data.categoryId ? { categoryId } : {}),
      });
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
  const savePoints = () =>
    start(async () => {
      const changed = lines.filter((l) => l.points !== l.auto);
      if (changed.some((l) => l.reason.trim().length < 3)) {
        setMsg({ tone: 'danger', text: 'Give the reason for each criterion awarded differently.' });
        return;
      }
      const r = await actions.points({
        action: 'confirm',
        lines: lines.map((l) => ({
          name: l.name,
          points: l.points,
          ...(l.points !== l.auto ? { reason: l.reason.trim() } : {}),
        })),
      });
      if (r.ok) window.location.reload();
      else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <div className="ep-arv">
      <section className="ep-card ep-arv__head" aria-label="Candidate">
        {data.photoFileId && !noPhoto ? (
          <img
            className="ep-arv__photo"
            src={fileUrl(data.photoFileId)}
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
                      <th scope="col">From the form</th>
                      <th scope="col">Counts</th>
                      {mode === 'points' ? <th scope="col">Reason</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(mode === 'points' ? lines : data.points.lines).map((l, i) => (
                      <tr key={l.name}>
                        <td>
                          {l.name}
                          {l.check ? <span className="ep-arv__check">Check: {l.check}</span> : null}
                          {l.reason && mode !== 'points' ? (
                            <span className="ep-field__help" style={{ display: 'block' }}>
                              Awarded differently: {l.reason}
                            </span>
                          ) : null}
                        </td>
                        <td className="ep-num">{l.max}</td>
                        <td className="ep-num">{l.auto}</td>
                        <td className="ep-num">
                          {mode === 'points' ? (
                            <input
                              className="ep-input ep-arv__num"
                              inputMode="decimal"
                              aria-label={`Points for ${l.name}`}
                              value={Number.isNaN(l.points) ? '' : l.points}
                              onChange={(e) => {
                                const t = e.target.value.replace(/[^\d.-]/g, '');
                                setLines((cur) =>
                                  cur.map((x, j) =>
                                    j === i
                                      ? { ...x, points: t === '' || t === '-' ? 0 : Number(t) }
                                      : x,
                                  ),
                                );
                              }}
                            />
                          ) : (
                            <strong>{l.points}</strong>
                          )}
                        </td>
                        {mode === 'points' ? (
                          <td>
                            <input
                              className="ep-input"
                              aria-label={`Reason for ${l.name}`}
                              disabled={l.points === l.auto}
                              value={l.reason ?? ''}
                              maxLength={300}
                              onChange={(e) =>
                                setLines((cur) =>
                                  cur.map((x, j) =>
                                    j === i ? { ...x, reason: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ep-field__help" style={{ marginBottom: 0 }}>
                {data.points.confirmedAt
                  ? `Confirmed${data.points.confirmedBy ? ` by ${data.points.confirmedBy}` : ''}.`
                  : 'Worked out from the form; not confirmed yet.'}
                {data.merit !== null ? ` Merit with marks: ${String(data.merit)}.` : ''}
              </p>
              {data.mayDecide && atDocs ? (
                mode === 'points' ? (
                  <div className="ep-arv__acts">
                    <button
                      type="button"
                      className="ep-btn ep-btn--primary ep-btn--sm"
                      disabled={pending}
                      onClick={savePoints}
                    >
                      Confirm the points
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => setMode('decide')}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="ep-arv__acts">
                    <button
                      type="button"
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      onClick={() => setMode('points')}
                    >
                      Check or award differently
                    </button>
                  </div>
                )
              ) : null}
            </section>
          ) : null}

          <section className="ep-card" aria-labelledby="arv-docs">
            <h3 id="arv-docs" className="ep-arv__h">
              Documents
            </h3>
            {data.documents.length === 0 ? (
              <p className="ep-field__help">No documents asked.</p>
            ) : (
              <ul className="ep-arv__docs">
                {data.documents.map((d) => (
                  <li key={d.key}>
                    <span>{d.label}</span>
                    {d.files.length ? (
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                        {d.files.map((f, i) => (
                          <FileIcons
                            key={f.id}
                            view={fileUrl(f.id)}
                            save={fileUrl(f.id, true)}
                            label={`${d.label}${d.files.length > 1 ? ` ${String(i + 1)}` : ''}`}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className="ep-arv__check">Not uploaded</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ep-card" aria-labelledby="arv-form">
            <h3 id="arv-form" className="ep-arv__h">
              The form
            </h3>
            {data.sections.map((s, i) => (
              <details key={s.title} className="ep-arv__sec" open={i === 0}>
                <summary>{s.title}</summary>
                <dl className="ep-arv__dl">
                  {s.items.map((x) => (
                    <div key={x.label}>
                      <dt>{x.label}</dt>
                      <dd>{x.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </section>
        </div>

        <aside className="ep-arv__side">
          {data.mayDecide ? (
            <section className="ep-card" aria-labelledby="arv-decide">
              <h3 id="arv-decide" className="ep-arv__h">
                Your decision
              </h3>
              <div role="group" aria-label="What to do" className="ep-arv__modes">
                <button
                  type="button"
                  className={`ep-btn ep-btn--sm ${mode !== 'send' ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
                  aria-pressed={mode !== 'send'}
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
              {atDocs && mode !== 'send' && data.categories.length ? (
                <label className="ep-field">
                  <span className="ep-field__label">Fee category</span>
                  <select
                    className="ep-select"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    {data.categories.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
                    disabled={pending}
                    onClick={() => decide('approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary"
                    disabled={pending}
                    onClick={() => decide('hold')}
                  >
                    Hold
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--danger"
                    disabled={pending}
                    onClick={() => decide('reject')}
                  >
                    Reject
                  </button>
                </div>
              )}
            </section>
          ) : null}

          <section className="ep-card" aria-labelledby="arv-path">
            <h3 id="arv-path" className="ep-arv__h">
              Decisions and remarks
            </h3>
            <ol className="ep-arv__path">
              {data.path.map((s) => (
                <li key={s.stageId} data-state={s.state}>
                  <strong>{s.name}</strong>
                  <ul>
                    {s.levels.map((l) => (
                      <li key={l.no}>
                        <span className="ep-field__help">
                          {s.levels.length > 1 ? `Level ${String(l.no)} · ` : ''}
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
                            {s.state === 'current' ? 'Waiting' : '-'}
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
