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
                  <Button type="submit" name="action" value="collect" size="sm">
                    {l('collect')}
                  </Button>
                  <Button type="submit" name="action" value="waive" size="sm" variant="ghost">
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
    </>
  );
}
