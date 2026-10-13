'use client';

import { useState } from 'react';
import type { MiscResult, MiscSheetRow } from '@/lib/misc-fee-actions';
import { EMPTY_AUDIENCE, MiscAudience, type MiscAudienceValue } from './MiscAudience';

type Option = { value: string; label: string };
type Found = { id: string; name: string; admissionNo: string; section: string | null };

/** More pupils on an announced misc fee: the same picker as the announcement; it goes for approval. */
export function MiscAddPupils({
  feeId,
  classes,
  sections,
  add,
  findPupils,
  readSheet,
}: {
  feeId: string;
  classes: Option[];
  sections: Option[];
  add: (
    feeId: string,
    audience: MiscAudienceValue,
    reason: string,
  ) => Promise<MiscResult<{ id: string }>>;
  findPupils: (q: string) => Promise<MiscResult<Found[]>>;
  readSheet: (base64: string) => Promise<MiscResult<{ rows: MiscSheetRow[]; errors: string[] }>>;
}) {
  const [audience, setAudience] = useState<MiscAudienceValue>(EMPTY_AUDIENCE);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen =
    audience.classIds.length +
    audience.sectionIds.length +
    audience.studentIds.length +
    audience.rows.length;
  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await add(feeId, audience, reason.trim());
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    window.location.href = `/fees/misc-fees/${feeId}?ok=1&detail=${encodeURIComponent('Request to add pupils saved: it takes effect when approved')}`;
  };
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <MiscAudience
        classes={classes}
        sections={sections}
        value={audience}
        onChange={setAudience}
        findPupils={findPupils}
        readSheet={readSheet}
      />
      <label className="ep-field" htmlFor="mf-add-reason" style={{ margin: 0 }}>
        <span className="ep-field__label">Reason</span>
        <input
          id="mf-add-reason"
          className="ep-input"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={busy || chosen === 0 || reason.trim().length < 3}
          onClick={() => void submit()}
        >
          {busy ? 'Sending…' : 'Send for approval'}
        </button>
      </div>
    </div>
  );
}
