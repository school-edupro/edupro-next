import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BorrowerCard } from '@/components/library/desk/DeskParts';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import type { DeskBorrower } from '@/lib/library-desk';

type Loan = {
  loanId: string;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string | null;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewed: number;
  daysLate: number;
  fine: number;
  fineState: string | null;
  outcome: string;
  charged: number | null;
  issuedBy: string | null;
  returnedBy: string | null;
};
type History = {
  borrower: { kind: string; id: string; name: string; ref: string; place: string | null };
  rows: Loan[];
  totals: { loans: number; out: number; late: number; fines: number };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  Returned: 'success',
  'Returned damaged': 'warning',
  Lost: 'danger',
  Overdue: 'danger',
  Out: 'info',
};

/**
 * One pupil's or staff member's library history (docs/design/36-library.md, "Library reports", part 2):
 * the borrower's card (rule, books held, dues), the books held between two days (every loan when no day
 * is chosen) with renewals, days late, the fine and where it is, how each loan ended; Excel or PDF.
 */
export default async function BorrowerHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  if ((kind !== 'student' && kind !== 'employee') || !/^\d{1,18}$/.test(id)) notFound();
  const from = DAY.test(sp.from ?? '') ? sp.from! : '';
  const to = DAY.test(sp.to ?? '') ? sp.to! : '';
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  let history: History;
  let card: DeskBorrower | null;
  try {
    [history, card] = await Promise.all([
      apiFetch<History>(`/library/history/borrowers/${kind}/${id}${q ? `?${q}` : ''}`),
      apiFetch<DeskBorrower>(`/library/desk/borrowers/${kind}/${id}`).catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const b = history.borrower;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/library-report?${new URLSearchParams({ report: 'borrower', kind, id, ...(from ? { from } : {}), ...(to ? { to } : {}), format }).toString()}`;
  const span = from || to ? `${from ? dmy(from) : '…'} to ${to ? dmy(to) : '…'}` : 'every loan';
  const staff = kind === 'employee';

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          {
            label: 'Circulation history',
            href: `/library/history?view=${kind}${q ? `&${q}` : ''}`,
          },
          { label: b.name },
        ]}
      />
      <PageHeader
        kicker={staff ? 'Library · staff member' : 'Library · pupil'}
        title={b.name}
        description={`${b.ref}${b.place ? ` · ${b.place}` : ''} · the books held ${from || to ? `between ${span}` : 'since the first loan'}.`}
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/library/circulation?tab=borrower"
            >
              Circulation desk
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
      <div className="ep-dash-kpis ep-dash-kpis--4">
        {(
          [
            ['Books', String(history.totals.loans), span],
            ['Out now', String(history.totals.out), 'of these'],
            ['Returned late', String(history.totals.late), 'or late now'],
            ['Late fines', rupees(history.totals.fines), span],
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
      {card ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <BorrowerCard b={card} history={false} />
        </div>
      ) : null}
      <div className="ep-filter-band">
        <form method="get" action={`/library/history/${kind}/${id}`} className="ep-dlog__filters">
          <InputField id="bh-from" name="from" type="date" label="Held from" defaultValue={from} />
          <InputField id="bh-to" name="to" type="date" label="To" defaultValue={to} />
          <Button type="submit">Show</Button>
          {from || to ? (
            <a className="ep-btn ep-btn--secondary" href={`/library/history/${kind}/${id}`}>
              Every loan
            </a>
          ) : null}
        </form>
      </div>
      <section className="ep-card" aria-labelledby="bh-list-h">
        <h2 id="bh-list-h" className="ep-card__title">
          Books · {history.totals.loans}
        </h2>
        {history.rows.length === 0 ? (
          <p className="ep-field__help">
            {from || to ? 'No book was held between these days.' : 'No book borrowed yet.'}
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${b.name}'s books (scrolls sideways)`}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">Issued on</th>
                  <th scope="col">Due on</th>
                  <th scope="col">Returned on</th>
                  <th scope="col" className="is-numeric">
                    Days late
                  </th>
                  <th scope="col">How it ended</th>
                  <th scope="col" className="is-numeric">
                    Fine
                  </th>
                  <th scope="col">Fine now</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((x) => (
                  <tr key={x.loanId}>
                    <td>
                      <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                      <div className="ep-field__help">
                        {x.accessionNo}
                        {x.author ? ` · ${x.author}` : ''}
                      </div>
                    </td>
                    <td>
                      {dmy(x.issuedOn)}
                      {x.issuedBy ? <div className="ep-field__help">by {x.issuedBy}</div> : null}
                    </td>
                    <td>
                      {dmy(x.dueOn)}
                      {x.renewed ? (
                        <div className="ep-field__help">renewed {x.renewed}×</div>
                      ) : null}
                    </td>
                    <td>
                      {x.returnedOn ? dmy(x.returnedOn) : '—'}
                      {x.returnedBy ? (
                        <div className="ep-field__help">by {x.returnedBy}</div>
                      ) : null}
                    </td>
                    <td className="is-numeric">{x.daysLate || '—'}</td>
                    <td>
                      <Badge tone={OUTCOME_TONE[x.outcome] ?? 'neutral'}>{x.outcome}</Badge>
                      {x.charged !== null ? (
                        <div className="ep-field__help">charged {rupees(x.charged)}</div>
                      ) : null}
                    </td>
                    <td className="is-numeric">{x.fine ? rupees(x.fine) : '—'}</td>
                    <td>{x.fineState ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={6}>
                    Total · {history.totals.loans} book{history.totals.loans === 1 ? '' : 's'}
                  </th>
                  <td className="is-numeric">
                    <strong>{rupees(history.totals.fines)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
