'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ResultsOptions } from '@/lib/admission-results';
import { resultsExport, resultsSessionExport } from '@/lib/admission-results-actions';
import { saveFile } from '@/lib/save-file';

const count = (n: number) => (n ? ` · ${String(n)}` : '');

/**
 * Test results' session, class and stage (docs/design/58, part 3): each choice opens at once; the
 * classes follow the session, with the candidates who reached a test or interview; "Every class" is
 * the session's overview.
 */
export function ResultsPicker({
  opts,
  cycleId,
  classId,
  stageId,
  children,
}: {
  opts: ResultsOptions;
  cycleId: string;
  classId: string | null;
  stageId: string;
  /** the downloads, at the bar's end */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cycle = opts.cycles.find((y) => y.id === cycleId);
  const go = (p: { cycleId: string; classId?: string; stageId?: string }) =>
    start(() => {
      const q = new URLSearchParams({ cycleId: p.cycleId });
      if (p.classId) {
        q.set('classId', p.classId);
        q.set('stageId', p.stageId ?? stageId);
      }
      router.push(`/admissions/results?${q.toString()}`);
    });

  return (
    <div className="ep-card ep-lead-filter" style={{ marginBottom: 'var(--sp-4)' }}>
      <label className="ep-field">
        <span className="ep-field__label">Session</span>
        <select
          className="ep-select"
          value={cycleId}
          disabled={pending}
          onChange={(e) => go({ cycleId: e.target.value })}
        >
          {opts.cycles.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {y.candidates
                ? ` · ${String(y.candidates)} candidate${y.candidates === 1 ? '' : 's'}`
                : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Class</span>
        <select
          className="ep-select"
          value={classId ?? ''}
          disabled={pending}
          onChange={(e) => go({ cycleId, classId: e.target.value || undefined })}
        >
          <option value="">Every class (overview)</option>
          {(cycle?.classes ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {count(k.candidates)}
            </option>
          ))}
        </select>
      </label>
      {classId ? (
        <label className="ep-field">
          <span className="ep-field__label">Stage</span>
          <select
            className="ep-select"
            value={stageId}
            disabled={pending}
            onChange={(e) => go({ cycleId, classId, stageId: e.target.value })}
          >
            {opts.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {pending ? (
        <p className="ep-field__help" role="status" style={{ alignSelf: 'flex-end' }}>
          Opening…
        </p>
      ) : null}
      {children ? (
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>{children}</div>
      ) : null}
    </div>
  );
}

/**
 * Test results' downloads, at the top of the page (docs/design/58, part 3): the class and stage as
 * filtered (Excel, PDF) when one is open, and the whole session (an overview, then each class and
 * stage) always.
 */
export function ResultsExports({ cycleId, query }: { cycleId: string; query?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (job: () => ReturnType<typeof resultsSessionExport>) =>
    start(async () => {
      setError(null);
      const r = await job();
      if (r.ok) saveFile(r.data);
      else setError(r.error);
    });
  const button = (
    label: string,
    sr: string,
    job: () => ReturnType<typeof resultsSessionExport>,
  ) => (
    <button
      key={label + sr}
      type="button"
      className="ep-btn ep-btn--secondary ep-btn--sm"
      style={{ whiteSpace: 'nowrap' }}
      disabled={pending}
      onClick={() => run(job)}
    >
      {label}
      <span className="ep-sr-only"> {sr}</span>
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div
        role="group"
        aria-label="Downloads"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}
      >
        {query ? (
          <>
            {button('Class Excel', 'of the class as filtered', () => resultsExport(query, 'xlsx'))}
            {button('Class PDF', 'of the class as filtered', () => resultsExport(query, 'pdf'))}
          </>
        ) : null}
        {button('Session Excel', 'with a sheet per class and stage', () =>
          resultsSessionExport(cycleId, 'xlsx'),
        )}
        {button('Session PDF', 'with a section per class and stage', () =>
          resultsSessionExport(cycleId, 'pdf'),
        )}
      </div>
      {pending ? (
        <p className="ep-field__help" role="status" style={{ margin: 0 }}>
          Preparing the file…
        </p>
      ) : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
