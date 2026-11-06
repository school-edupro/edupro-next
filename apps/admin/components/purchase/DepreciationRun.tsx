'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { runDepreciation, type DepreciationResult } from '@/lib/purchase-actions';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The year's depreciation: check what it comes to, then save it. */
export function DepreciationRun({ years }: { years: string[] }) {
  const router = useRouter();
  const [fy, setFy] = useState(years[0] ?? '');
  const [result, setResult] = useState<DepreciationResult | null>(null);
  const [pending, start] = useTransition();
  const go = (dryRun: boolean) =>
    start(async () => {
      const r = await runDepreciation(fy, dryRun);
      setResult(r);
      if (r.ok && r.saved) router.refresh();
    });
  const ok = result?.ok ? result : null;
  return (
    <>
      <div className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="dp-fy">
          <span className="ep-field__label">Financial year</span>
          <select
            id="dp-fy"
            className="ep-select"
            value={fy}
            onChange={(e) => {
              setFy(e.target.value);
              setResult(null);
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={pending}
          onClick={() => go(true)}
        >
          Work it out
        </button>
        {ok && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save {ok.fy}
          </button>
        ) : null}
      </div>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {result.error}
        </p>
      ) : null}
      {ok ? (
        <p
          className={ok.saved ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--info'}
          role="status"
        >
          {ok.fy}: {ok.assets} assets, {money(ok.total)}
          {ok.earlierYears
            ? ` (and ${String(ok.earlierYears)} earlier asset-years not yet worked out)`
            : ''}
          {ok.saved ? ' — saved.' : ' — not saved yet.'}
        </p>
      ) : null}
    </>
  );
}
