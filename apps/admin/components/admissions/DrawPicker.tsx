'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { DrawOptions } from '@/lib/admission-draw';

/** Draw of lots' session, class and category (docs/design/60): each choice opens at once. */
export function DrawPicker({
  opts,
  cycleId,
  classId,
  categoryId,
  tab,
}: {
  opts: DrawOptions;
  cycleId: string;
  classId: string;
  categoryId: string;
  tab: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cycle = opts.cycles.find((y) => y.id === cycleId);
  const go = (p: { cycleId: string; classId?: string; categoryId?: string }) =>
    start(() => {
      const q = new URLSearchParams({ cycleId: p.cycleId });
      if (p.classId) q.set('classId', p.classId);
      if (p.categoryId) q.set('categoryId', p.categoryId);
      if (tab !== 'slips') q.set('tab', tab);
      router.push(`/admissions/draw?${q.toString()}`);
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
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Class</span>
        <select
          className="ep-select"
          value={classId}
          disabled={pending}
          onChange={(e) => go({ cycleId, classId: e.target.value, categoryId })}
        >
          {(cycle?.classes ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.withMerit ? ` · ${String(k.withMerit)} on the merit list` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Category</span>
        <select
          className="ep-select"
          value={categoryId}
          disabled={pending}
          onChange={(e) => go({ cycleId, classId, categoryId: e.target.value })}
        >
          <option value="">Every category</option>
          {opts.categories.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      {pending ? (
        <p className="ep-field__help" role="status" style={{ alignSelf: 'flex-end' }}>
          Opening…
        </p>
      ) : null}
    </div>
  );
}
