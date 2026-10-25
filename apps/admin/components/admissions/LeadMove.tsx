'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { moveLead } from '@/lib/admission-enquiry-actions';
import { LOST_REASONS, type EnquiryStage } from '@/lib/admission-enquiry';

/**
 * Move a lead (docs/design/45, part 2): to an open stage at once, or to Lost after its reason. The
 * registration's own stages are not offered: they follow the family's registration.
 */
export function LeadMove({
  id,
  name,
  stageId,
  stages,
}: {
  id: string;
  /** who the lead is, for the control's name */
  name: string;
  stageId: string | null;
  stages: EnquiryStage[];
}) {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const choices = stages.filter(
    (s) => s.status === 'active' && (s.kind === 'open' || s.kind === 'lost') && s.id !== stageId,
  );
  const lost = choices.find((s) => s.id === to)?.kind === 'lost';
  const go = (target: string, why?: string) =>
    start(async () => {
      setError('');
      const r = await moveLead(id, target, why);
      if (r.ok) {
        setTo('');
        setReason('');
        router.refresh();
      } else setError(r.error);
    });
  return (
    <span className="ep-lead-move">
      <select
        className="ep-select ep-select--sm"
        aria-label={`Move ${name} to`}
        data-native
        value={to}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setTo(v);
          if (v && choices.find((s) => s.id === v)?.kind === 'open') go(v);
        }}
      >
        <option value="">Move to…</option>
        {choices.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {lost ? (
        <>
          <select
            className="ep-select ep-select--sm"
            aria-label={`Why ${name} is lost`}
            data-native
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Why?</option>
            {LOST_REASONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={!reason || pending}
            onClick={() => go(to, reason)}
          >
            Mark lost
          </button>
        </>
      ) : null}
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
