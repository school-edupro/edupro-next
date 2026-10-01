'use client';
import { useMemo, useState } from 'react';
import type { PortalField, Value } from '../app/profile/types';
import { applies } from '../app/profile/types';

export interface EditLabels {
  needsApproval: string;
  savedAtOnce: string;
  waiting: string;
  attach: string;
  attachHelp: string;
  reason: string;
  reasonPlaceholder: string;
  send: string;
  save: string;
  cancel: string;
  nothing: string;
  proofFor: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const asText = (v: Value): string => (v === null || v === undefined ? '' : String(v));

/**
 * One section of the profile for a parent to update: only the fields the school opened, with which
 * ones need approval, the proof each change needs, and nothing sent for fields left as they were.
 */
export function ProfileEditForm({
  action,
  studentId,
  section,
  fields,
  context,
  proofKinds,
  labels,
}: {
  action: (fd: FormData) => Promise<void>;
  studentId: string;
  section: string;
  fields: PortalField[];
  context: Record<string, Value>;
  proofKinds: Array<{ id: string; label: string }>;
  labels: EditLabels;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, asText(f.value)])),
  );
  const all = { ...context, ...values };
  const changed = fields.filter((f) => !f.pending && values[f.key] !== asText(f.value));
  const proofs = useMemo(() => {
    const need = new Map<string, string[]>();
    for (const f of changed)
      if (f.proof) need.set(f.proof, [...(need.get(f.proof) ?? []), f.label]);
    return [...need.entries()];
  }, [changed]);
  const anyApproval = changed.some((f) => f.level === 'edit_approval');

  return (
    <form action={action} className="pp-edit" encType="multipart/form-data">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="section" value={section} />
      {fields.map((f) => {
        if (!applies(f, all)) return null;
        const id = `f-${f.key}`;
        const listId = f.options ? `dl-${f.key}` : undefined;
        const type = f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text';
        const numeric = [
          'mobile',
          'pin',
          'year',
          'number',
          'digits12',
          'digits11',
          'account',
        ].includes(f.type);
        const isChanged = !f.pending && values[f.key] !== asText(f.value);
        return (
          <div key={f.key} className={`pp-edit__row${isChanged ? ' pp-edit__row--changed' : ''}`}>
            <label className="ep-field" htmlFor={id}>
              <span className="ep-field__label">
                {f.label}
                <span className={`pp-tag pp-tag--${f.level}`}>
                  {f.level === 'edit_direct' ? labels.savedAtOnce : labels.needsApproval}
                </span>
              </span>
              {f.pending ? (
                <>
                  <input
                    id={id}
                    className="ep-input"
                    value={asText(f.pending.to)}
                    disabled
                    readOnly
                  />
                  <span className="ep-field__help">{labels.waiting}</span>
                </>
              ) : (
                <>
                  <input type="hidden" name={`o.${f.key}`} value={asText(f.value)} />
                  <input
                    id={id}
                    name={`v.${f.key}`}
                    className="ep-input"
                    type={type}
                    inputMode={numeric ? 'numeric' : undefined}
                    list={listId}
                    autoComplete="off"
                    maxLength={300}
                    style={f.upper ? { textTransform: 'uppercase' } : undefined}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  {listId ? (
                    <datalist id={listId}>
                      {f.options!.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  ) : null}
                  {f.help ? <span className="ep-field__help">{f.help}</span> : null}
                </>
              )}
            </label>
          </div>
        );
      })}

      {proofs.length ? (
        <fieldset className="pp-edit__proofs">
          <legend>{labels.attach}</legend>
          <p className="ep-field__help">{labels.attachHelp}</p>
          {proofs.map(([kind, forLabels]) => (
            <label key={kind} className="ep-field" htmlFor={`proof-${kind}`}>
              <span className="ep-field__label">
                {cap(proofKinds.find((k) => k.id === kind)?.label ?? kind)} *{' '}
                <span className="ep-field__help">
                  ({labels.proofFor} {forLabels.join(', ')})
                </span>
              </span>
              <input
                id={`proof-${kind}`}
                name={`proof.${kind}`}
                type="file"
                className="ep-input"
                required
                accept="application/pdf,image/jpeg,image/png,image/webp"
              />
            </label>
          ))}
        </fieldset>
      ) : null}

      {anyApproval ? (
        <label className="ep-field" htmlFor="pp-reason">
          <span className="ep-field__label">{labels.reason}</span>
          <input
            id="pp-reason"
            name="reason"
            className="ep-input"
            maxLength={500}
            placeholder={labels.reasonPlaceholder}
          />
        </label>
      ) : null}

      <div className="pp-edit__bar">
        <a className="ep-btn ep-btn--ghost" href={`/profile?child=${studentId}`}>
          {labels.cancel}
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={!changed.length}>
          {!changed.length ? labels.nothing : anyApproval ? labels.send : labels.save}
        </button>
      </div>
    </form>
  );
}
