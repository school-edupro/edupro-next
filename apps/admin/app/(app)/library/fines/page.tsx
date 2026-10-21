import { libraryFine__action } from '@/lib/choice-actions';
import { Button, Card, DataTable, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { libraryFine } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { LibraryLoan, Page } from '@/lib/types';

/** Sprint 17: outstanding fines — collect or waive. */
export default async function FinesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, l, fines] = await Promise.all([
    getTranslations('pages.library_fines'),
    getTranslations('library'),
    apiFetch<Page<LibraryLoan>>('/library/loans?status=fines&size=200'),
  ]);
  // lost and damaged books: charged as misc fees, paid at the fees counter
  const charges = await apiFetch<{
    rows: Array<{
      id: string;
      kind: string;
      borrower: string;
      borrowerRef: string;
      accessionNo: string;
      titleId: string;
      title: string;
      due: number;
      state: string;
    }>;
    counts: { due: number; dueAmount: number };
  }>('/library/charges?status=due').catch(() => null);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<LibraryLoan>
          caption={`${t('title')} · ${fines.page.total}`}
          density="dense"
          columns={[
            {
              key: 'b',
              header: l('borrower'),
              render: (x) => (
                <>
                  {x.borrower}
                  <div className="ep-kicker">
                    {x.borrowerKind} · {x.borrowerRef}
                  </div>
                </>
              ),
            },
            {
              key: 't',
              header: l('title'),
              render: (x) => (
                <>
                  {x.title}
                  <div className="ep-kicker">{x.accessionNo}</div>
                </>
              ),
            },
            { key: 'd', header: l('dueOn'), render: (x) => `${x.dueOn} → ${x.returnedOn ?? ''}` },
            {
              key: 'f',
              header: l('fine'),
              numeric: true,
              render: (x) => `₹${(Number(x.fineAmount) - Number(x.fineWaived)).toFixed(2)}`,
            },
            {
              key: 'a',
              header: '',
              render: (x) => (
                <form
                  action={libraryFine}
                  style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                >
                  <input type="hidden" name="loanId" value={x.id} />
                  <InputField
                    id={`ref-${x.id}`}
                    name="reference"
                    label={l('reference')}
                    maxLength={60}
                  />
                  <InputField id={`note-${x.id}`} name="note" label={l('note')} maxLength={300} />
                  <Button
                    type="submit"
                    formAction={libraryFine__action.bind(null, 'collect')}
                    size="sm"
                  >
                    {l('collect')}
                  </Button>
                  <Button
                    type="submit"
                    formAction={libraryFine__action.bind(null, 'waive')}
                    size="sm"
                    variant="ghost"
                  >
                    {l('waive')}
                  </Button>
                </form>
              ),
            },
          ]}
          rows={fines.data}
          rowKey={(x) => x.id}
          emptyTitle={l('noFines')}
        />
      </Card>
      {charges ? (
        <section className="ep-card" aria-labelledby="fn-ch-h" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="fn-ch-h" className="ep-card__title">
            Lost and damaged books · {charges.counts.due} due (₹
            {charges.counts.dueAmount.toFixed(2)})
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Charged as misc fees and paid at the fees counter, not here.{' '}
            <a href="/library/charges">Lost and damaged books</a>
          </p>
          {charges.rows.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Lost and damaged books due (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Borrower</th>
                    <th scope="col">Book</th>
                    <th scope="col">What</th>
                    <th scope="col" className="is-numeric">
                      Due
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {charges.rows.slice(0, 50).map((x) => (
                    <tr key={x.id}>
                      <td>
                        {x.borrower}
                        <div className="ep-kicker">{x.borrowerRef}</div>
                      </td>
                      <td>
                        <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                        <div className="ep-kicker">{x.accessionNo}</div>
                      </td>
                      <td>{x.kind === 'lost' ? 'Lost' : 'Damaged'}</td>
                      <td className="is-numeric">₹{x.due.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
