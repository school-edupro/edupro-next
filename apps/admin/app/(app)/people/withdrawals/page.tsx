import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import type { Page, Withdrawal } from '@/lib/types';

const tone = (s: Withdrawal['status']) =>
  s === 'completed'
    ? 'success'
    : s === 'cancelled'
      ? 'danger'
      : s === 'cleared'
        ? 'info'
        : 'warning';

/** S7-02: withdrawal register with clearance progress. */
export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const [t, l, c] = await Promise.all([
    getTranslations('pages.people_withdrawals'),
    getTranslations('lifecycle'),
    getTranslations('common'),
  ]);
  const status = sp.status ?? 'open';
  const list = await apiFetch<Page<Withdrawal>>(`/people/withdrawals?size=100&status=${status}`);
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
          <SelectField
            id="status"
            name="status"
            label={l('status')}
            defaultValue={status}
            options={[
              { value: 'open', label: l('open') },
              { value: 'completed', label: l('withdrawalStatuses.completed') },
              { value: 'cancelled', label: l('withdrawalStatuses.cancelled') },
            ]}
          />
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<Withdrawal>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'student',
              header: l('student'),
              render: (w) => (
                <a href={`/people/withdrawals/${w.id}`}>
                  {w.studentName} · {w.admissionNo}
                </a>
              ),
            },
            { key: 'section', header: c('name'), render: (w) => w.section ?? '' },
            { key: 'requested', header: l('requestedOn'), render: (w) => w.requestedOn },
            { key: 'leaving', header: l('leavingOn'), render: (w) => w.leavingOn },
            { key: 'reason', header: l('reason'), render: (w) => w.reason },
            {
              key: 'progress',
              header: l('clearances'),
              render: (w) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {w.clearances.map((x) => (
                    <Badge
                      key={x.id}
                      tone={
                        x.status === 'cleared'
                          ? 'success'
                          : x.status === 'hold'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {x.department}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'status',
              header: l('status'),
              render: (w) => (
                <Badge tone={tone(w.status)}>{l(`withdrawalStatuses.${w.status}`)}</Badge>
              ),
            },
          ]}
          rows={list.data}
          rowKey={(w) => w.id}
          emptyTitle={l('noWithdrawals')}
        />
      </Card>
    </>
  );
}
