'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { processBatch } from '@/lib/payroll-runs-actions';

/** Works the run out a batch at a time (25 employees), showing the progress, until it is done. */
export function ProcessButton({
  runId,
  label = 'Process the run',
  disabled = false,
}: {
  runId: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    let failed = 0;
    for (let i = 0; i < 400; i += 1) {
      const r = await processBatch(runId);
      if (r.error) {
        setError(r.error);
        break;
      }
      setProgress(r.progress);
      failed += Object.values(r.failures).reduce((n, x) => n + x, 0);
      if (r.done) {
        setNote(
          failed
            ? `Done: ${String(failed)} could not be worked out (marked Failed).`
            : 'Done: everyone is worked out.',
        );
        break;
      }
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="ep-grid__toolbar">
      <button
        type="button"
        className="ep-btn ep-btn--primary"
        onClick={() => void go()}
        disabled={busy || disabled}
      >
        {busy ? 'Working…' : label}
      </button>
      {busy || progress ? (
        <progress
          max={100}
          value={progress}
          aria-label="Progress of the run"
          style={{ width: 'calc(var(--sp-5) * 6)' }}
        >
          {progress} %
        </progress>
      ) : null}
      <span role="status" aria-live="polite" className="ep-field__help">
        {busy ? `${String(progress)} %` : note}
      </span>
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
