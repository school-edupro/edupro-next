import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { libraryIssue, libraryRenew, libraryReturn } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { LibraryLoan, Page } from '@/lib/types';

/** Sprint 17: issue / renew / return by accession number; open and overdue loans. */
export default async function CirculationPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = sp.status === 'overdue' || sp.status === 'returned' ? sp.status : 'open';
  const [t, l, loans] = await Promise.all([
    getTranslations('pages.library_circulation'),
    getTranslations('library'),
    apiFetch<Page<LibraryLoan>>(
      `/library/loans?status=${status}&size=100${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`,
    ),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card title={l('issue')}>
          <form action={libraryIssue}>
            <FormRow columns={2}>
              <InputField
                id="i-acc"
                name="accessionNo"
                label={l('accessionNo')}
                required
                maxLength={30}
              />
              <SelectField
                id="i-kind"
                name="borrowerKind"
                label={l('borrowerKind')}
                options={[
                  { value: 'student', label: l('student') },
                  { value: 'employee', label: l('employee') },
                ]}
              />
              <InputField
                id="i-bid"
                name="borrowerId"
                label={l('borrowerId')}
                required
                pattern="\\d+"
              />
              <InputField id="i-due" name="dueOn" label={l('dueOn')} type="date" />
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">{l('issue')}</Button>
            </div>
          </form>
        </Card>
        <Card title={l('return')}>
          <form action={libraryReturn}>
            <FormRow columns={2}>
              <InputField
                id="r-acc"
                name="accessionNo"
                label={l('accessionNo')}
                required
                maxLength={30}
              />
              <InputField id="r-on" name="returnedOn" label={l('returnedOn')} type="date" />
              <SelectField
                id="r-cond"
                name="condition"
                label={l('condition')}
                options={['available', 'damaged', 'lost'].map((v) => ({ value: v, label: v }))}
              />
              <label
                style={{
                  display: 'inline-flex',
                  gap: 'var(--sp-1)',
                  alignItems: 'center',
                  alignSelf: 'end',
                }}
              >
                <input type="checkbox" name="waiveFine" /> {l('waiveFine')}
              </label>
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                {l('return')}
              </Button>
            </div>
          </form>
        </Card>
        <Card title={l('renew')}>
          <form action={libraryRenew}>
            <FormRow columns={1}>
              <InputField
                id="n-acc"
                name="accessionNo"
                label={l('accessionNo')}
                required
                maxLength={30}
              />
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                {l('renew')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <Card
        title={status === 'overdue' ? l('overdue') : l('openLoans')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="status"
              name="status"
              label={l('status')}
              defaultValue={status}
              options={[
                { value: 'open', label: l('openLoans') },
                { value: 'overdue', label: l('overdue') },
                { value: 'returned', label: l('return') },
              ]}
            />
            <InputField
              id="q"
              name="q"
              label={l('search')}
              defaultValue={sp.q ?? ''}
              maxLength={80}
            />
            <Button type="submit" variant="secondary" size="sm">
              {l('apply')}
            </Button>
          </form>
        }
      >
        <DataTable<LibraryLoan>
          caption={`${l('openLoans')} · ${loans.page.total}`}
          density="dense"
          columns={[
            { key: 'a', header: l('accessionNo'), render: (x) => <strong>{x.accessionNo}</strong> },
            {
              key: 't',
              header: l('title'),
              render: (x) => (
                <>
                  {x.title}
                  <div className="ep-kicker">{x.author ?? ''}</div>
                </>
              ),
            },
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
            { key: 'i', header: l('issuedOn'), render: (x) => x.issuedOn },
            {
              key: 'd',
              header: l('dueOn'),
              render: (x) => (
                <>
                  {x.dueOn}
                  {x.daysOverdue > 0 && !x.returnedOn ? (
                    <>
                      {' '}
                      <Badge tone="danger">
                        {x.daysOverdue} {l('days')}
                      </Badge>
                    </>
                  ) : null}
                </>
              ),
            },
            { key: 'r', header: l('returnedOn'), render: (x) => x.returnedOn ?? '' },
            {
              key: 'f',
              header: l('fine'),
              numeric: true,
              render: (x) => (Number(x.fineAmount) > 0 ? `₹${x.fineAmount}` : ''),
            },
          ]}
          rows={loans.data}
          rowKey={(x) => x.id}
          emptyTitle={l('noLoans')}
        />
      </Card>
    </>
  );
}
