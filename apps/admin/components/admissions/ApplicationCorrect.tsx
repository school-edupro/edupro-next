'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { correctApplication } from '@/lib/student-correction-actions';

/** Answers the office may correct here (files, photos, the signature and the declaration stay the family's). */
const SCALAR = [
  'text',
  'textarea',
  'number',
  'email',
  'mobile',
  'date',
  'select',
  'radio',
  'yesno',
];

export interface CorrectableField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}
export interface AnswerChange {
  id: string;
  label: string;
  from: string | null;
  to: string | null;
  reason: string;
  by: string | null;
  at: string;
}
type Row = { key: string; value: string };

const asText = (v: unknown) =>
  v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);

const nowText = (f: CorrectableField, v: unknown) => {
  const t = asText(v);
  const m = f.type === 'date' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) : null;
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : t;
};

/**
 * The office corrects answers of a submitted application before Admit (docs/design/37, case 1b): pick a
 * question, type the right answer, give the reason; each change is kept with its old and new value.
 */
export function ApplicationCorrect({
  id,
  fields,
  answers,
  history,
  canCorrect,
}: {
  id: string;
  fields: CorrectableField[];
  answers: Record<string, unknown>;
  history: AnswerChange[];
  canCorrect: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>([]);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const usable = fields.filter((f) => SCALAR.includes(f.type));
  const byLabel = (label: string) =>
    usable.find((f) => f.label.toLowerCase() === label.trim().toLowerCase());
  const add = () => {
    const f = byLabel(pick);
    if (!f || rows.some((r) => r.key === f.key)) return;
    setRows((r) => [...r, { key: f.key, value: asText(answers[f.key]) }]);
    setPick('');
  };
  const save = () =>
    start(async () => {
      setErrors({});
      const out = await correctApplication(
        id,
        Object.fromEntries(
          rows.map((r) => {
            const f = usable.find((x) => x.key === r.key)!;
            const v = r.value.trim();
            return [
              r.key,
              v === ''
                ? null
                : f.type === 'number'
                  ? Number(v)
                  : f.type === 'yesno'
                    ? v === 'Yes'
                    : v,
            ];
          }),
        ),
        reason.trim(),
      );
      if (out.ok) {
        setMsg({
          tone: 'success',
          text: `Corrected: ${out.data.changed.map((x) => x.label).join(', ')}.`,
        });
        setRows([]);
        setReason('');
        router.refresh();
      } else {
        setErrors(out.errors ?? {});
        setMsg({ tone: 'danger', text: out.errors?._ ?? out.error });
      }
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {canCorrect ? (
        <>
          <p style={{ margin: 0 }}>
            Correct a wrong answer before Admit. Each change is kept with the old and new value;
            files and photos are asked from the family with Send back.
          </p>
          <div className="ep-rp__row">
            <label className="ep-field" htmlFor={`${uid}-pick`} style={{ flex: 1 }}>
              <span className="ep-field__label">Question</span>
              <input
                id={`${uid}-pick`}
                className="ep-input"
                list={`${uid}-questions`}
                autoComplete="off"
                value={pick}
                placeholder="Type to search the questions"
                onChange={(e) => setPick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              <datalist id={`${uid}-questions`}>
                {usable
                  .filter((f) => !rows.some((r) => r.key === f.key))
                  .map((f) => (
                    <option key={f.key} value={f.label} />
                  ))}
              </datalist>
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={!byLabel(pick)}
              onClick={add}
            >
              Add
            </button>
          </div>
          {rows.map((r) => {
            const f = usable.find((x) => x.key === r.key)!;
            const fid = `${uid}-${r.key}`;
            const choices = f.type === 'yesno' ? ['Yes', 'No'] : (f.options ?? []);
            const set = (value: string) =>
              setRows((all) => all.map((x) => (x.key === r.key ? { ...x, value } : x)));
            return (
              <div key={r.key} className="ep-rp__row" style={{ alignItems: 'flex-end' }}>
                <label className="ep-field" htmlFor={fid} style={{ flex: 1 }}>
                  <span className="ep-field__label">{f.label}</span>
                  {f.type === 'textarea' ? (
                    <textarea
                      id={fid}
                      className="ep-input"
                      rows={2}
                      value={r.value}
                      onChange={(e) => set(e.target.value)}
                    />
                  ) : (
                    <input
                      id={fid}
                      className="ep-input"
                      type={
                        f.type === 'date'
                          ? 'date'
                          : f.type === 'number'
                            ? 'number'
                            : f.type === 'email'
                              ? 'email'
                              : 'text'
                      }
                      list={choices.length ? `${fid}-list` : undefined}
                      autoComplete="off"
                      value={r.value}
                      aria-invalid={errors[r.key] ? 'true' : undefined}
                      aria-describedby={`${fid}-was`}
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                  {choices.length ? (
                    <datalist id={`${fid}-list`}>
                      {choices.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  ) : null}
                  <span id={`${fid}-was`} className="ep-field__help">
                    Now: {nowText(f, answers[r.key]) || '(blank)'}
                  </span>
                  {errors[r.key] ? (
                    <span className="ep-field__error" role="alert">
                      {f.label} {errors[r.key]}
                    </span>
                  ) : null}
                </label>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Remove ${f.label}`}
                  onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {rows.length ? (
            <>
              <label className="ep-field" htmlFor={`${uid}-reason`}>
                <span className="ep-field__label">Reason</span>
                <input
                  id={`${uid}-reason`}
                  className="ep-input"
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  placeholder="e.g. as in the birth certificate seen at the desk"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="ep-form-actions">
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending || reason.trim().length < 3}
                  onClick={save}
                >
                  Save the corrections
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      {history.length ? (
        <ul className="ep-rp__events">
          {history.map((x) => (
            <li key={x.id}>
              {x.label}: {x.from ?? '(blank)'} → <strong>{x.to ?? '(blank)'}</strong> · {x.reason}
              <div className="ep-field__help">
                {x.by ?? ''} ·{' '}
                {new Date(x.at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : canCorrect ? null : (
        <p style={{ margin: 0 }}>No answer corrected by the office.</p>
      )}
    </div>
  );
}
