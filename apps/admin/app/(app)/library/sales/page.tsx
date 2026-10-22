import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { Pager } from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { BUYER_KIND, FROM_STATUS, rupees, SALE_STATE, type SaleRow } from '@/lib/library-sales';

type Report = {
  rows: SaleRow[];
  total: number;
  page: number;
  pages: number;
  totals: { books: number; amount: number; paid: number; due: number };
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ['all', 'due', 'paid', 'free', 'cancelled'] as const;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Books sold (docs/design/36-library.md, "Library reports", part 4): the sales between two days (this
 * month until days are chosen), by buyer and payment, with the totals; each sale opens with its books and
 * its receipt; sell at the desk or from a file; the list as Excel or PDF.
 */
export default async function LibrarySalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify')) notFound();
  const chosen = 'from' in sp || 'to' in sp;
  const from = chosen ? (DAY.test(sp.from ?? '') ? sp.from! : '') : `${today().slice(0, 8)}01`;
  const to = chosen ? (DAY.test(sp.to ?? '') ? sp.to! : '') : today();
  const buyer = ['student', 'employee', 'other'].includes(sp.buyer ?? '') ? sp.buyer! : '';
  const state = STATES.includes((sp.state ?? '') as (typeof STATES)[number]) ? sp.state! : 'all';
  const search = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const api = (x: Record<string, string>) =>
    new URLSearchParams(Object.entries(x).filter(([, v]) => v !== '')).toString();
  // the page's own links keep empty days once chosen ("every day")
  const link = (x: Record<string, string>) =>
    new URLSearchParams(
      Object.entries(x).filter(([k, v]) => v !== '' || (chosen && (k === 'from' || k === 'to'))),
    ).toString();
  const f = { from, to, buyer, state, q: search };
  const data = await apiFetch<Report>(
    `/library/sales?${api({ ...f, page: String(page), size: '50' })}`,
  );
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/library-report?${api({ report: 'sales', ...f, format })}`;
  const span = from || to ? `${from ? dmy(from) : '…'} to ${to ? dmy(to) : '…'}` : 'every day';

  return (
    <>
      <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Book sales' }]} />
      <PageHeader
        kicker="Library"
        title="Book sales"
        description="Books sold from the library: a pupil or staff member pays at the fees counter (a misc fee), someone outside pays at the library on a misc receipt."
        actions={
          <>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/library/sales/new">
              + Sell books
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/sales/upload">
              Upload sales
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </>
        }
      />
      <Notice params={sp} />
      <LibraryScopeNote />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        {(
          [
            ['Books sold', String(data.totals.books), span],
            ['Sold for', rupees(data.totals.amount), span],
            ['Paid', rupees(data.totals.paid), 'at the counter or on receipts'],
            ['Due', rupees(data.totals.due), 'misc fees not paid yet'],
          ] as Array<[string, string, string]>
        ).map(([label, value, sub]) => (
          <Card key={label} title={label}>
            <div className="ep-cdash__big">{value}</div>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {sub}
            </p>
          </Card>
        ))}
      </div>
      <div className="ep-filter-band">
        <form method="get" action="/library/sales" className="ep-dlog__filters">
          <InputField id="ls-from" name="from" type="date" label="Sold from" defaultValue={from} />
          <InputField id="ls-to" name="to" type="date" label="To" defaultValue={to} max={today()} />
          <SelectField
            id="ls-buyer"
            name="buyer"
            label="Buyers"
            defaultValue={buyer}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'student', label: 'Pupils' },
              { value: 'employee', label: 'Staff' },
              { value: 'other', label: 'Outside the school' },
            ]}
          />
          <SelectField
            id="ls-state"
            name="state"
            label="Payment"
            defaultValue={state}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'due', label: 'Due at the fees counter' },
              { value: 'paid', label: 'Paid' },
              { value: 'free', label: 'No price' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <div className="ep-dlog__search">
            <InputField
              id="ls-q"
              name="q"
              type="search"
              label="Search"
              placeholder="Book, book no., buyer, admission or employee no., sale no."
              maxLength={80}
              defaultValue={search}
            />
          </div>
          <Button type="submit">Show</Button>
          <a className="ep-btn ep-btn--secondary" href="/library/sales">
            Reset
          </a>
        </form>
      </div>
      <section className="ep-card" id="list" aria-labelledby="ls-list-h">
        <h2 id="ls-list-h" className="ep-card__title">
          Books sold · {data.total}
        </h2>
        {data.rows.length === 0 ? (
          <p className="ep-field__help">No book was sold for these filters.</p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Books sold (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Sold on</th>
                  <th scope="col">Sale</th>
                  <th scope="col">Book</th>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="is-numeric">
                    Sold for
                  </th>
                  <th scope="col">Payment</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((x) => (
                  <tr key={x.id}>
                    <td>{dmy(x.soldOn)}</td>
                    <td>
                      <a href={`/library/sales/${x.orderId}`}>{x.saleNo}</a>
                    </td>
                    <td>
                      {x.title}
                      <div className="ep-field__help">
                        {x.accessionNo}
                        {x.fromStatus
                          ? ` · was ${(FROM_STATUS[x.fromStatus] ?? x.fromStatus).toLowerCase()}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      {x.buyer}
                      <div className="ep-field__help">
                        {BUYER_KIND[x.buyerKind]}
                        {x.buyerRef ? ` · ${x.buyerRef}` : ''}
                      </div>
                    </td>
                    <td className="is-numeric">
                      {rupees(x.price)}
                      {x.copyPrice !== null ? (
                        <div className="ep-field__help">bought {rupees(x.copyPrice)}</div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={SALE_STATE[x.state][1]}>{SALE_STATE[x.state][0]}</Badge>
                      {x.receiptNo ? (
                        <div className="ep-field__help">
                          {x.receiptNo}
                          {x.mode ? ` · ${x.mode.toUpperCase()}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{x.soldBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    Total · {data.totals.books} book{data.totals.books === 1 ? '' : 's'}
                  </th>
                  <td className="is-numeric">
                    <strong>{rupees(data.totals.amount)}</strong>
                  </td>
                  <td colSpan={2}>
                    Paid {rupees(data.totals.paid)} · due {rupees(data.totals.due)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager
          page={data.page}
          pages={data.pages}
          hrefFor={(n) => `/library/sales?${link({ ...f, page: String(n) })}#list`}
        />
      </section>
    </>
  );
}
