import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { COUNT_STATUS, inr, type CountRow } from '@/lib/purchase';
import { startCount } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${iso}T00:00:00+05:30`))
    : 'never';

/**
 * Physical counts (docs/design/84, part 8; GFR 2017 rule 213 — every store at least once a year): the
 * stores and when each was last counted, the counts open and done, and a new count of a store (or one
 * category of it).
 */
export default async function CountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await apiFetch<{
    rows: CountRow[];
    stores: Array<{
      id: string;
      name: string;
      lastCountedOn: string | null;
      countedThisYear: boolean;
      mine: boolean;
    }>;
    categories: Array<{ id: string; name: string }>;
  }>(`/purchase/counts?page=${String(Math.max(1, Number(sp.page) || 1))}`);
  const mine = data.stores.filter((s) => s.mine);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Physical counts' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Physical counts"
        description="Every store is counted at least once a year. The keeper counts what is on the shelves (the sheet does not show the book quantity), gives the reason for each difference, and the school admin approves: the differences then post as adjustments."
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="ct-stores">
        <h2 id="ct-stores" className="ep-card__title">
          The stores
        </h2>
        <ul className="ep-purch-checks">
          {data.stores.map((s) => (
            <li key={s.id}>
              {s.name}: last counted {when(s.lastCountedOn)}{' '}
              <Badge tone={s.countedThisYear ? 'success' : 'warning'}>
                {s.countedThisYear ? 'Counted this year' : 'Not counted this year'}
              </Badge>
            </li>
          ))}
        </ul>
        {mine.length ? (
          <form
            action={startCount}
            className="ep-grid__toolbar"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <label className="ep-field" htmlFor="ct-store">
              <span className="ep-field__label">Store</span>
              <select id="ct-store" name="storeId" className="ep-select" required>
                {mine.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="ct-cat">
              <span className="ep-field__label">Items</span>
              <select id="ct-cat" name="categoryId" className="ep-select">
                <option value="">Everything it holds</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} only
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="ct-note">
              <span className="ep-field__label">Note</span>
              <input id="ct-note" name="note" className="ep-input" maxLength={1000} />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Start a count
            </button>
          </form>
        ) : null}
      </section>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Counts">
        <table className="ep-table">
          <caption className="ep-sr-only">Counts</caption>
          <thead>
            <tr>
              <th scope="col">Count</th>
              <th scope="col">Store</th>
              <th scope="col">Counted</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Differences
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/counts/${x.id}`}>{x.number}</a>
                    <span className="ep-mr-col__desc">{when(x.countedOn)}</span>
                  </td>
                  <td>
                    {x.store}
                    <span className="ep-mr-col__desc">{x.category ?? 'Everything'}</span>
                  </td>
                  <td>
                    {x.counted} of {x.lines}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {x.differences}
                    {x.status === 'approved' && x.value ? (
                      <span className="ep-mr-col__desc">{inr(x.value)}</span>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={COUNT_STATUS[x.status].tone}>{COUNT_STATUS[x.status].label}</Badge>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>No counts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
