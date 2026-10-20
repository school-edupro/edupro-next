'use client';
import { useState, useTransition } from 'react';
import { saveRecruitmentNotices } from '@/lib/recruitment-actions';
import type { RecruitmentNotices } from '@/lib/recruitment';

/**
 * Which notices go to candidates and how (docs/design/34-recruitment.md, part 3). The wording is the
 * school's templates under Communication (recruitment_applied, _scheduled, _selected, _not_selected); an
 * SMS goes only once its template has the DLT id, a WhatsApp once it has the approved template name.
 */
export function NoticesEditor({
  initial,
  canEdit,
}: {
  initial: RecruitmentNotices;
  canEdit: boolean;
}) {
  const [n, setN] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const tick = (k: keyof RecruitmentNotices, label: string) => (
    <label key={k} className="ep-check" htmlFor={`rn-${k}`}>
      <input
        id={`rn-${k}`}
        type="checkbox"
        checked={n[k]}
        disabled={!canEdit}
        onChange={(e) => setN((x) => ({ ...x, [k]: e.target.checked }))}
      />{' '}
      {label}
    </label>
  );
  return (
    <section
      className="ep-card"
      aria-labelledby="rn-h"
      style={{ padding: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}
    >
      <h2 id="rn-h" className="ep-card__title">
        Notices to candidates
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The words are the school’s templates under Communication. An SMS goes once its template has
        the DLT id; a WhatsApp once it has the approved template name.
      </p>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </p>
      ) : null}
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">Tell the candidate when</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          {tick('applied', 'the application is received')}
          {tick('scheduled', 'a stage is scheduled')}
          {tick('selected', 'they are selected')}
          {tick('rejected', 'they are not taken forward')}
        </div>
      </fieldset>
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">By</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          {tick('sms', 'SMS')}
          {tick('whatsapp', 'WhatsApp')}
          {tick('email', 'Email')}
        </div>
      </fieldset>
      {canEdit ? (
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveRecruitmentNotices(n);
              setMsg(
                r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error },
              );
            })
          }
        >
          Save
        </button>
      ) : null}
    </section>
  );
}
