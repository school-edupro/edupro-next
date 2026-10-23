import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { COPY_STATUS, COPY_TONE, dmy, type CopyStatus } from '@/lib/library-books';
import { rupees } from '@/lib/library-desk';
import { HISTORY_LABEL, type CopyCheck } from '@/lib/library-overview';

/**
 * One copy at a glance: its status, where it sits, who has it (due date, days late, fine so far), who it
 * is kept for or who waits for the title, the other copies, charges, and its whole history.
 */
export default async function CopyCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  const { id } = await params;
  if (!me.permissions.includes('library.catalogue.view') || !/^\d{1,18}$/.test(id)) notFound();
  let d: CopyCheck;
  try {
    d = await apiFetch<CopyCheck>(`/library/check/copies/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { copy, title, loan } = d;
  const status = copy.status as CopyStatus;
  const canDesk = me.permissions.includes('library.loan.circulate');
  const fact = (label: string, value: string | null | undefined) =>
    value ? (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;
  return (
    <>
      <PageHeader
        kicker={`Library · Accession no. ${copy.accessionNo}`}
        title={title.title}
        description={[
          title.author,
          title.material,
          title.callNo ? `Call no. ${title.callNo}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <span className="ep-cdash__export">
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/library/books/${title.id}`}>
              Open the book
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/check">
              Check another
            </a>
          </span>
        }
      />
      <Card>
        <form method="get" action="/library/check" className="ep-dlog__filters" role="search">
          <label className="ep-field ep-dlog__search" htmlFor="ck-q">
            <span className="ep-field__label">Check another: accession no., barcode or title</span>
            <input
              id="ck-q"
              name="q"
              type="search"
              className="ep-input"
              autoComplete="off"
              maxLength={120}
            />
          </label>
          <Button type="submit" variant="secondary">
            Check
          </Button>
        </form>
      </Card>
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginTop: 'var(--sp-4)' }}>
        <Card title="Status">
          <div className="ep-ldash__value">
            <Badge tone={COPY_TONE[status] ?? 'neutral'}>
              {COPY_STATUS[status] ?? copy.status}
            </Badge>
          </div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {copy.statusOn ? `since ${dmy(copy.statusOn)}` : ''}
            {copy.statusReason ? ` · ${copy.statusReason}` : ''}
            {title.reference ? ' · reference only' : ''}
          </p>
        </Card>
        <Card title="Where">
          <div className="ep-ldash__value">{copy.library}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {[copy.shelf ? `Shelf ${copy.shelf}` : null, copy.rack ? `Rack ${copy.rack}` : null]
              .filter(Boolean)
              .join(' · ') || 'No shelf set'}
          </p>
        </Card>
        <Card title={loan ? 'With' : 'Borrower'}>
          <div className="ep-ldash__value">{loan ? (loan.name ?? '—') : '—'}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {loan ? [loan.ref, loan.place].filter(Boolean).join(' · ') : 'Not on loan'}
          </p>
        </Card>
        <Card title={loan ? 'Due back' : 'Last verified'}>
          <div className="ep-ldash__value">
            {loan ? dmy(loan.dueOn) : copy.lastVerifiedOn ? dmy(copy.lastVerifiedOn) : '—'}
          </div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {loan
              ? loan.daysLate
                ? `${String(loan.daysLate)} days late · fine so far ${rupees(loan.fineSoFar)}`
                : 'not late'
              : 'at a stock check'}
          </p>
        </Card>
      </div>
      {loan ? (
        <div
          className={`ep-alert ${loan.daysLate ? 'ep-alert--warning' : 'ep-alert--info'}`}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <span>
            Issued on {dmy(loan.issuedOn)} to <strong>{loan.name}</strong>
            {loan.ref ? ` (${loan.ref})` : ''}, due {dmy(loan.dueOn)}
            {loan.renewed
              ? `, renewed ${String(loan.renewed)} time${loan.renewed === 1 ? '' : 's'}`
              : ''}
            .{' '}
            <a href={`/library/history/${loan.borrowerKind}/${loan.borrowerId}`}>
              Their library history
            </a>
            {canDesk ? (
              <>
                {' · '}
                <a href="/library/circulation?tab=return">Take it back at the desk</a>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {d.hold ? (
        <p className="ep-alert ep-alert--info">
          <span>
            Kept for <strong>{d.hold.name}</strong>
            {d.hold.ref ? ` (${d.hold.ref})` : ''}, who reserved it, until {dmy(d.hold.until)}.
          </span>
        </p>
      ) : null}
      <div className="ep-cdash__two">
        <Card title="This copy">
          <dl className="ep-hd__facts">
            {fact('Accession no.', copy.accessionNo)}
            {fact('Old numbers', copy.formerNos)}
            {fact('Barcode', copy.barcode)}
            {fact('Accessioned on', dmy(copy.accessionedOn))}
            {fact('Came by', copy.acquisition)}
            {fact('Vendor', copy.vendor)}
            {fact('Donated by', copy.donor)}
            {fact('Bill', [copy.billNo, dmy(copy.billDate)].filter(Boolean).join(' · ') || null)}
            {fact('Price', copy.price !== null ? rupees(copy.price) : null)}
            {fact('Remarks', copy.remarks)}
          </dl>
        </Card>
        <Card title="The book">
          <dl className="ep-hd__facts">
            {fact('Subtitle', title.subtitle)}
            {fact('Subject', title.subject)}
            {fact('Publisher', title.publisher)}
            {fact(
              'Edition',
              [title.edition, title.year ? String(title.year) : null].filter(Boolean).join(' · ') ||
                null,
            )}
            {fact('Language', title.language)}
            {fact('ISBN', title.isbn)}
          </dl>
          {d.queue.length ? (
            <>
              <h3 className="ep-cdash__h3">Waiting for this title ({d.queue.length})</h3>
              <ol className="ep-cdash__list">
                {d.queue.map((w, i) => (
                  <li key={i}>
                    {w.name}{' '}
                    <span className="ep-field__help">
                      · {[w.ref, w.place].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </Card>
      </div>
      {d.others.length ? (
        <Card
          title={`Other copies of this book (${String(d.others.length)})`}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Other copies">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Other copies of this book</caption>
              <thead>
                <tr>
                  <th scope="col">Accession no.</th>
                  <th scope="col">Library</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due back</th>
                </tr>
              </thead>
              <tbody>
                {d.others.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <a href={`/library/check/${o.id}`}>{o.accessionNo}</a>
                    </td>
                    <td>{o.library}</td>
                    <td>
                      <Badge tone={COPY_TONE[o.status as CopyStatus] ?? 'neutral'}>
                        {COPY_STATUS[o.status as CopyStatus] ?? o.status}
                      </Badge>
                    </td>
                    <td>{o.dueOn ? dmy(o.dueOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {d.charges.length ? (
        <Card title="Charges on this copy" style={{ marginTop: 'var(--sp-4)' }}>
          <ul className="ep-cdash__list">
            {d.charges.map((c, i) => (
              <li key={i}>
                {c.kind === 'late'
                  ? 'Late fine'
                  : c.kind === 'lost'
                    ? 'Lost'
                    : c.kind === 'damaged'
                      ? 'Damaged'
                      : c.kind}{' '}
                · {rupees(c.amount)}{' '}
                <span className="ep-field__help">
                  · {c.name} {c.ref ? `(${c.ref})` : ''} · {dmy(c.on)}
                  {c.reason ? ` · ${c.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="History" style={{ marginTop: 'var(--sp-4)' }}>
        {d.history.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="History of this copy"
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">History of this copy, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col">Who</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h, i) => (
                  <tr key={i}>
                    <td>{dmy(h.on)}</td>
                    <td>{HISTORY_LABEL[h.what] ?? h.what}</td>
                    <td>
                      {h.name ?? '—'}
                      {h.ref || h.place ? (
                        <div className="ep-field__help">
                          {[h.ref, h.place].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {h.detail ?? ''}
                      {h.amount ? ` · ${rupees(h.amount)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No history yet.</p>
        )}
      </Card>
    </>
  );
}
