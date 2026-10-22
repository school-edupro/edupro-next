import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { chargeBook } from '@/lib/library-books-actions';
import { dmy } from '@/lib/library-books';

type Preview = {
  kind: 'lost' | 'damaged';
  on: string;
  accessionNo: string;
  title: string;
  borrowerKind: string;
  borrower: string;
  borrowerRef: string;
  issuedOn: string;
  dueOn: string;
  daysLate: number;
  price: number;
  processingFee: number;
  lateFine: number;
  sharePct: number;
  suggested: number;
  canCharge: boolean;
};
type Charge = {
  id: string;
  kind: string;
  on: string;
  borrowerKind: string;
  borrower: string;
  borrowerRef: string;
  accessionNo: string;
  titleId: string;
  title: string;
  price: number;
  processingFee: number;
  lateFine: number;
  charged: number;
  amount: number;
  paid: number;
  due: number;
  reason: string | null;
  foundOn: string | null;
  state: 'due' | 'paid' | 'found_pending' | 'cancelled';
  paidOn: string | null;
  receipts: string | null;
  by: string | null;
};
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE: Record<Charge['state'], [string, string]> = {
  due: ['Due at the fees counter', 'warning'],
  paid: ['Paid', 'success'],
  found_pending: ['Found again: the fees office decides', 'info'],
  cancelled: ['Cancelled', 'neutral'],
};
const TABS = [
  ['due', 'Due'],
  ['paid', 'Paid'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Lost and damaged books (docs/design/36-library.md, part 3 of the register work): a book a pupil has
 * reported lost (its price + the processing fee + the late fine) or returned damaged (what the librarian
 * enters, a share of the price suggested); the charge is announced at once as a misc fee, paid at the
 * fees counter; the list shows what is due and what is paid.
 */
export default async function LibraryChargesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  const acc = (sp.acc ?? '').trim().slice(0, 30);
  const kind = sp.kind === 'damaged' ? 'damaged' : sp.kind === 'lost' ? 'lost' : null;
  const on = /^\d{4}-\d{2}-\d{2}$/.test(sp.on ?? '') ? sp.on! : '';
  const status = TABS.some(([v]) => v === sp.status) ? sp.status! : 'due';
  // the list's filters: the days charged (paid: the days paid), pupils or staff, a search
  const f: Record<string, string> = {};
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) f[k] = sp[k]!;
  if (sp.borrower === 'student' || sp.borrower === 'employee') f.borrower = sp.borrower;
  const search = (sp.q ?? '').trim().slice(0, 80);
  if (search) f.q = search;
  const qs = (x: Record<string, string>) => new URLSearchParams(x).toString();
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/library-report?${qs({ report: 'charges', status, ...f, format })}`;
  let preview: Preview | null = null;
  let previewError: string | null = null;
  // a refused charge comes back with its own error; the preview is not asked again then
  if (acc && kind && !sp.error) {
    try {
      const q = new URLSearchParams({ accessionNo: acc, kind, ...(on ? { on } : {}) });
      preview = await apiFetch<Preview>(`/library/charges/preview?${q.toString()}`);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      previewError = String(e.problem.detail ?? e.problem.type);
    }
  }
  const list = await apiFetch<{
    rows: Charge[];
    total: number;
    totals: { charged: number; paid: number; due: number };
    counts: { due: number; paid: number; cancelled: number; dueAmount: number };
  }>(`/library/charges?${qs({ status, ...f })}`);
  const finder = (k: 'lost' | 'damaged', title: string, help: string) => (
    <section className="ep-card" aria-labelledby={`lc-${k}-h`}>
      <h2 id={`lc-${k}-h`} className="ep-card__title">
        {title}
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {help}
      </p>
      <form method="get" action="/library/charges">
        <input type="hidden" name="kind" value={k} />
        <div className="ep-acr-filter">
          <label className="ep-field" htmlFor={`lc-${k}-acc`} style={{ margin: 0 }}>
            <span className="ep-field__label">Accession no. *</span>
            <input
              id={`lc-${k}-acc`}
              name="acc"
              className="ep-input"
              required
              maxLength={30}
              defaultValue={kind === k ? acc : ''}
            />
          </label>
          <label className="ep-field" htmlFor={`lc-${k}-on`} style={{ margin: 0 }}>
            <span className="ep-field__label">{k === 'lost' ? 'Reported on' : 'Returned on'}</span>
            <input
              id={`lc-${k}-on`}
              name="on"
              type="date"
              className="ep-input"
              max={today()}
              defaultValue={kind === k ? on : ''}
            />
          </label>
        </div>
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Work out the charge
          </button>
        </div>
      </form>
    </section>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Library', href: '/library' }, { label: 'Lost and damaged' }]}
      />
      <PageHeader
        kicker="Library"
        title="Lost and damaged books"
        description="A borrower who loses a book pays its price, the processing fee and the late fine; a damaged book, what you set. The charge is announced at once as a misc fee, on the pupil (the parent sees it) or the staff member, and the fees counter collects it. Until it is paid, the borrower takes no more books."
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {finder(
          'lost',
          'A book reported lost',
          'The book is on loan to a pupil or a staff member; the loan closes and the copy is marked lost.',
        )}
        {finder(
          'damaged',
          'A book returned damaged',
          'The borrower brings it back damaged; the loan closes and the copy is marked damaged.',
        )}
      </div>

      {previewError ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {previewError}
        </p>
      ) : null}

      {preview ? (
        <section
          className="ep-card"
          aria-labelledby="lc-prev-h"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="lc-prev-h" className="ep-card__title">
            {preview.kind === 'lost' ? 'Lost' : 'Damaged'}: {preview.title} ({preview.accessionNo})
          </h2>
          <dl className="ep-sheet__grid">
            {(
              [
                [
                  'Borrower',
                  `${preview.borrower} · ${preview.borrowerKind === 'student' ? 'Pupil' : 'Staff'} ${preview.borrowerRef}`,
                ],
                [
                  'Issued on · due on',
                  `${dmy(preview.issuedOn)} · ${dmy(preview.dueOn)}${preview.daysLate ? ` · ${String(preview.daysLate)} days late` : ''}`,
                ],
                [
                  'Price',
                  preview.price ? rupees(preview.price) : 'No price on the copy or the title',
                ],
                ...(preview.kind === 'lost'
                  ? [
                      ['Processing fee', rupees(preview.processingFee)],
                      [`Late fine to ${dmy(preview.on)}`, rupees(preview.lateFine)],
                    ]
                  : [
                      ['Suggested share', `${String(preview.sharePct)}% of the price`],
                      ...(preview.lateFine
                        ? [
                            [
                              `Late fine to ${dmy(preview.on)}`,
                              `${rupees(preview.lateFine)} (announced on its own as a misc fee)`,
                            ],
                          ]
                        : []),
                    ]),
                ['Charge worked out', rupees(preview.suggested)],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{k === 'Charge worked out' ? <strong>{v}</strong> : v}</dd>
              </div>
            ))}
          </dl>
          <form action={chargeBook} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="kind" value={preview.kind} />
            <input type="hidden" name="accessionNo" value={preview.accessionNo} />
            <input type="hidden" name="on" value={preview.on} />
            <div className="ep-acr-filter">
              <label className="ep-field" htmlFor="lc-amount" style={{ margin: 0 }}>
                <span className="ep-field__label">Charge (₹) *</span>
                <input
                  id="lc-amount"
                  name="amount"
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  className="ep-input"
                  defaultValue={preview.suggested || ''}
                />
                <span className="ep-field__help">
                  {preview.kind === 'lost'
                    ? 'Change it only with the reason below'
                    : 'What the repair or the loss of use is worth'}
                </span>
              </label>
              <label className="ep-field" htmlFor="lc-reason" style={{ margin: 0 }}>
                <span className="ep-field__label">
                  {preview.kind === 'lost' ? 'Reason (if the charge differs)' : 'What is damaged *'}
                </span>
                <input
                  id="lc-reason"
                  name="reason"
                  className="ep-input"
                  maxLength={300}
                  required={preview.kind === 'damaged'}
                />
              </label>
              {preview.kind === 'damaged' && preview.lateFine ? (
                <label className="ep-check" htmlFor="lc-waive" style={{ alignSelf: 'end' }}>
                  <input id="lc-waive" type="checkbox" name="waiveFine" /> Waive the late fine
                </label>
              ) : null}
            </div>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                {preview.kind === 'lost' ? 'Mark lost and charge' : 'Return damaged and charge'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="lc-list-h">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-2)',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <h2 id="lc-list-h" className="ep-card__title">
            Charges · {list.counts.due} due ({rupees(list.counts.dueAmount)})
          </h2>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </span>
        </div>
        <nav
          className="ep-tabs"
          aria-label="Charges by state"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <div className="ep-tabs__list">
            {TABS.map(([v, label]) => (
              <a
                key={v}
                className="ep-tabs__tab"
                href={`/library/charges?${qs({ status: v, ...f })}#lc-list-h`}
                aria-current={status === v ? 'page' : undefined}
              >
                {label}
                {v !== 'all' ? (
                  <>
                    {' '}
                    <span className="ep-badge ep-badge--neutral">
                      {list.counts[v as 'due' | 'paid' | 'cancelled']}
                    </span>
                  </>
                ) : null}
              </a>
            ))}
          </div>
        </nav>
        <form method="get" action="/library/charges" className="ep-dlog__filters ep-filter-band">
          <input type="hidden" name="status" value={status} />
          <label className="ep-field" htmlFor="lc-from" style={{ margin: 0 }}>
            <span className="ep-field__label">
              {status === 'paid' ? 'Paid from' : 'Charged from'}
            </span>
            <input
              id="lc-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={f.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="lc-to" style={{ margin: 0 }}>
            <span className="ep-field__label">To</span>
            <input
              id="lc-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={f.to ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="lc-borrower" style={{ margin: 0 }}>
            <span className="ep-field__label">Borrowers</span>
            <select
              id="lc-borrower"
              name="borrower"
              className="ep-select"
              defaultValue={f.borrower ?? ''}
            >
              <option value="">Pupils and staff</option>
              <option value="student">Pupils</option>
              <option value="employee">Staff</option>
            </select>
          </label>
          <label className="ep-field ep-dlog__search" htmlFor="lc-q" style={{ margin: 0 }}>
            <span className="ep-field__label">Search</span>
            <input
              id="lc-q"
              name="q"
              type="search"
              className="ep-input"
              maxLength={80}
              placeholder="Name, admission or employee no., book or book no."
              defaultValue={search}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary">
            Show
          </button>
          {Object.keys(f).length ? (
            <a className="ep-btn ep-btn--secondary" href={`/library/charges?status=${status}`}>
              Clear
            </a>
          ) : null}
        </form>
        {list.rows.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Charges (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Charged on</th>
                  <th scope="col">Borrower</th>
                  <th scope="col">Book</th>
                  <th scope="col">What</th>
                  <th scope="col" className="is-numeric">
                    Charged
                  </th>
                  <th scope="col" className="is-numeric">
                    Paid
                  </th>
                  <th scope="col" className="is-numeric">
                    Due
                  </th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((x) => (
                  <tr key={x.id}>
                    <td>{dmy(x.on)}</td>
                    <td>
                      {x.borrower}
                      <div className="ep-field__help">{x.borrowerRef}</div>
                    </td>
                    <td>
                      <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                      <div className="ep-field__help">{x.accessionNo}</div>
                    </td>
                    <td>
                      {x.kind === 'lost' ? 'Lost' : 'Damaged'}
                      <div className="ep-field__help">
                        {x.kind === 'lost'
                          ? `Price ${rupees(x.price)} + fee ${rupees(x.processingFee)} + late fine ${rupees(x.lateFine)}`
                          : ''}
                        {x.reason ? `${x.kind === 'lost' ? ' · ' : ''}${x.reason}` : ''}
                        {x.foundOn ? ` · found again ${dmy(x.foundOn)}` : ''}
                      </div>
                    </td>
                    <td className="is-numeric">
                      {rupees(x.amount)}
                      {x.amount !== x.charged ? (
                        <div className="ep-field__help">was {rupees(x.charged)}</div>
                      ) : null}
                    </td>
                    <td className="is-numeric">
                      {rupees(x.paid)}
                      {x.paidOn ? (
                        <div className="ep-field__help">
                          {dmy(x.paidOn)}
                          {x.receipts ? ` · ${x.receipts}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="is-numeric">{rupees(x.due)}</td>
                    <td>
                      <span className={`ep-badge ep-badge--${STATE[x.state][1]}`}>
                        {STATE[x.state][0]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>
                    Total · {list.total} charge{list.total === 1 ? '' : 's'}
                    {list.total > list.rows.length
                      ? ` (the first ${String(list.rows.length)} shown; the file has all)`
                      : ''}
                  </th>
                  <td className="is-numeric">
                    <strong>{rupees(list.totals.charged)}</strong>
                  </td>
                  <td className="is-numeric">
                    <strong>{rupees(list.totals.paid)}</strong>
                  </td>
                  <td className="is-numeric">
                    <strong>{rupees(list.totals.due)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">
            {Object.keys(f).length ? 'Nothing here for these filters.' : 'Nothing here.'}
          </p>
        )}
      </section>
    </>
  );
}
