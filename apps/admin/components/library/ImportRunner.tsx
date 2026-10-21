'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { runImport } from '@/lib/library-books-actions';

/**
 * Imports a checked upload batch after batch (docs/design/36-library.md, part 4), showing how far it has
 * gone; a row that fails is kept with its reason and the rest go on. Stopped, it carries on from where it
 * was when started again.
 */
export function ImportRunner({
  id,
  todo,
  started,
}: {
  id: string;
  /** rows that will be imported (new titles, new copies, updates) */
  todo: number;
  /** done already (an import stopped half way) */
  started: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(started);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    for (let i = 0; i < 500; i += 1) {
      const r = await runImport(id);
      if (!r.ok) {
        setError(r.error);
        break;
      }
      setDone(r.done + r.failed);
      setFailed(r.failed);
      if (r.status === 'done') {
        router.refresh();
        break;
      }
    }
    setBusy(false);
  };
  const pct = todo ? Math.round((done / todo) * 100) : 100;
  return (
    <div className="ep-book__runner">
      {busy || started ? (
        <label className="ep-field" htmlFor={`run-${id}`} style={{ margin: 0 }}>
          <span className="ep-field__label">
            {busy ? 'Importing…' : 'Stopped part way'} {done} of {todo}
            {failed ? ` · ${String(failed)} not imported` : ''}
          </span>
          <progress id={`run-${id}`} max={100} value={pct}>
            {pct}%
          </progress>
        </label>
      ) : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="ep-btn ep-btn--primary"
        disabled={busy || !todo}
        onClick={() => void go()}
      >
        {busy
          ? 'Importing…'
          : started
            ? 'Carry on importing'
            : `Import ${String(todo)} row${todo === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
