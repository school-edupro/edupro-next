import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  InputField,
  PageHeader,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { cancelWithdrawal, completeWithdrawal, recordClearance } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Clearance, Withdrawal } from '@/lib/types';

export default async function WithdrawalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, l, me, w] = await Promise.all([
    getTranslations('pages.people_withdrawals'),
    getTranslations('lifecycle'),
    getMe(),
    apiFetch<Withdrawal>(`/people/withdrawals/${id}`),
  ]);
  const canClear = me.permissions.includes('people.withdrawal.clear');
  const canManage = me.permissions.includes('people.withdrawal.manage');
  const open = w.status === 'requested' || w.status === 'cleared';
  const self = `/people/withdrawals/${id}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/people/students' },
          { label: t('title'), href: '/people/withdrawals' },
          { label: w.studentName },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${w.studentName} · ${w.admissionNo}`}
        description={`${w.section ?? ''} · ${l('requestedOn')} ${w.requestedOn} · ${l('leavingOn')} ${w.leavingOn} · ${w.reason}`}
        actions={
          <Badge
            tone={
              w.status === 'completed' ? 'success' : w.status === 'cancelled' ? 'danger' : 'warning'
            }
          >
            {l(`withdrawalStatuses.${w.status}`)}
          </Badge>
        }
      />
      <Notice params={sp} />
      <Card title={l('clearances')}>
        <DataTable<Clearance>
          caption={l('clearances')}
          density="dense"
          columns={[
            {
              key: 'dept',
              header: l('department'),
              render: (x) => <strong>{x.department}</strong>,
            },
            {
              key: 'status',
              header: l('status'),
              render: (x) => (
                <Badge
                  tone={
                    x.status === 'cleared' ? 'success' : x.status === 'hold' ? 'danger' : 'neutral'
                  }
                >
                  {l(x.status)}
                </Badge>
              ),
            },
            { key: 'dues', header: l('dues'), numeric: true, render: (x) => x.dues },
            { key: 'remarks', header: l('remarks'), render: (x) => x.remarks ?? '' },
            {
              key: 'by',
              header: l('actedBy'),
              render: (x) =>
                x.actedBy
                  ? `${x.actedBy} · ${new Date(x.actedAt!).toLocaleDateString('en-IN')}`
                  : '',
            },
            {
              key: 'act',
              header: '',
              render: (x) =>
                canClear && open ? (
                  <form
                    action={recordClearance}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    <input type="hidden" name="id" value={w.id} />
                    <input type="hidden" name="department" value={x.department} />
                    <input type="hidden" name="returnTo" value={self} />
                    <select
                      name="status"
                      className="ep-select"
                      defaultValue={x.status === 'cleared' ? 'cleared' : 'cleared'}
                      aria-label={l('status')}
                    >
                      <option value="cleared">{l('cleared')}</option>
                      <option value="hold">{l('hold')}</option>
                      <option value="pending">{l('pending')}</option>
                    </select>
                    <input
                      className="ep-input"
                      name="dues"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={x.dues}
                      style={{ width: 100 }}
                      aria-label={l('dues')}
                    />
                    <input
                      className="ep-input"
                      name="remarks"
                      placeholder={l('remarks')}
                      defaultValue={x.remarks ?? ''}
                      style={{ width: 200 }}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {l('clear')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={w.clearances}
          rowKey={(x) => x.id}
          emptyTitle={l('noWithdrawals')}
        />
      </Card>
      {canManage && open ? (
        <Card title={l('complete')} style={{ marginTop: 'var(--sp-5)' }}>
          {w.status !== 'cleared' ? (
            <div style={{ marginBottom: 'var(--sp-3)' }}>
              <Alert tone="warning">{l('completeHelp')}</Alert>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <form action={completeWithdrawal}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="returnTo" value={self} />
              <Button type="submit" disabled={w.status !== 'cleared'}>
                {l('complete')}
              </Button>
            </form>
            <form action={cancelWithdrawal} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="returnTo" value={self} />
              <InputField id="cancelReason" name="reason" label={l('cancelReason')} required />
              <FormActions>
                <Button type="submit" variant="secondary">
                  {l('cancel')}
                </Button>
              </FormActions>
            </form>
          </div>
        </Card>
      ) : null}
    </>
  );
}
