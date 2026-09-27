import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { cancelTc, renderTc } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page, TransferCertificate } from '@/lib/types';

/** S7-02: transfer certificate register. */
export default async function TcPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, l, c, me] = await Promise.all([
    getTranslations('pages.people_tc'),
    getTranslations('lifecycle'),
    getTranslations('common'),
    getMe(),
  ]);
  const canIssue = me.permissions.includes('people.tc.issue');
  const query = new URLSearchParams({ size: '100' });
  if (sp.q) query.set('q', sp.q);
  if (sp.status) query.set('status', sp.status);
  const list = await apiFetch<Page<TransferCertificate>>(`/people/tc?${query.toString()}`);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <InputField id="q" name="q" label={l('search')} defaultValue={sp.q ?? ''} />
          <SelectField
            id="status"
            name="status"
            label={l('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: c('all') },
              { value: 'issued', label: l('issued') },
              { value: 'cancelled', label: l('cancelled') },
            ]}
          />
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<TransferCertificate>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'no', header: l('tcNo'), render: (x) => <strong>{x.tcNo}</strong> },
            {
              key: 'student',
              header: l('student'),
              render: (x) => (
                <a href={`/people/students/${x.studentId}`}>
                  {x.studentName} · {x.admissionNo}
                </a>
              ),
            },
            { key: 'class', header: l('lastClass'), render: (x) => x.lastClass ?? '' },
            { key: 'on', header: l('issuedOn'), render: (x) => x.issuedOn },
            { key: 'reason', header: l('reason'), render: (x) => x.reason },
            { key: 'by', header: l('issuedBy'), render: (x) => x.issuedBy ?? '' },
            {
              key: 'status',
              header: l('status'),
              render: (x) => (
                <Badge tone={x.status === 'issued' ? 'success' : 'danger'}>{l(x.status)}</Badge>
              ),
            },
            {
              key: 'pdf',
              header: l('pdf'),
              render: (x) =>
                x.exportId ? (
                  <a href={`/reports/exports?highlight=${x.exportId}`}>
                    {l('pdf')} #{x.exportId}
                  </a>
                ) : canIssue && x.status === 'issued' ? (
                  <form action={renderTc}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="returnTo" value="/people/tc" />
                    <Button type="submit" variant="ghost" size="sm">
                      {l('generatePdf')}
                    </Button>
                  </form>
                ) : null,
            },
            {
              key: 'actions',
              header: '',
              render: (x) =>
                canIssue && x.status === 'issued' ? (
                  <form action={cancelTc} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="returnTo" value="/people/tc" />
                    <input
                      className="ep-input"
                      name="reason"
                      placeholder={l('cancelReason')}
                      required
                      style={{ width: 160 }}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {l('cancel')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={list.data}
          rowKey={(x) => x.id}
          emptyTitle={l('noTc')}
        />
      </Card>
    </>
  );
}
