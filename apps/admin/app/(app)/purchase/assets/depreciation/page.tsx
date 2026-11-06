import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { DepreciationRun } from '@/components/purchase/DepreciationRun';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type AssetLists } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * Depreciation (docs/design/84, part 9): the method per item category (Purchase set-up → Item
 * categories: straight line by useful life and salvage %, or written-down value by rate); the yearly
 * run, pro rata from the day put to use; the runs made; the fixed-asset register.
 */
export default async function DepreciationPage() {
  const me = await getMe();
  const lists = await apiFetch<AssetLists>('/purchase/asset-lists');
  const manage = me.permissions.includes('purchase.asset.manage');
  const start = Number(lists.currentFy.slice(0, 4));
  const years = [0, 1, 2, 3, 4].map(
    (k) => `${String(start - k)}-${String(start - k + 1).slice(2)}`,
  );
  const lastRun = lists.runs[0]?.fy;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Assets', href: '/purchase/assets' },
          { label: 'Depreciation' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Assets"
        title="Depreciation"
        description="Each item category has its method (Purchase set-up → Item categories): straight line over the useful life down to the salvage %, or written-down value at a rate a year. The year’s run works out every asset pro rata from the day it was put to use, catching up any earlier year not yet run."
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/purchase/reports?report=fixed_assets&to=${lastRun ? `${String(Number(lastRun.slice(0, 4)) + 1)}-03-31` : ''}`}
          >
            Fixed-asset register
          </a>
        }
      />
      {manage ? (
        <section className="ep-card" aria-labelledby="dp-run">
          <h2 id="dp-run" className="ep-card__title">
            Run a year
          </h2>
          <p style={{ marginTop: 0 }} className="ep-field__help">
            Run it at the year’s end. A year can be run again until a later year is run.
          </p>
          <DepreciationRun years={years.filter((y) => !lastRun || y >= lastRun)} />
        </section>
      ) : null}
      <section className="ep-card" aria-labelledby="dp-runs">
        <h2 id="dp-runs" className="ep-card__title">
          Years run
        </h2>
        {lists.runs.length ? (
          <ul className="ep-purch-checks">
            {lists.runs.map((r) => (
              <li key={r.fy}>
                <strong>{r.fy}</strong>: {r.assets} assets, {inr(r.total)} · {when(r.runAt)}
                {r.by ? ` by ${r.by}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">No year has been run yet.</p>
        )}
        <p className="ep-field__help">
          Categories with a method:{' '}
          {lists.categories
            .filter((c) => c.method)
            .map((c) => `${c.name} (${c.method === 'slm' ? 'straight line' : 'WDV'})`)
            .join(', ') || 'none yet — set them on Purchase set-up → Item categories'}
        </p>
      </section>
    </>
  );
}
