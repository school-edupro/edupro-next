import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { Page, Withdrawal } from '@/lib/types';

const tone = (s: Withdrawal['status']) =>
  s === 'completed'
    ? 'success'
    : s === 'cancelled'
      ? 'danger'
      : s === 'cleared'
        ? 'info'
        : 'warning';

/** Withdrawal register: open, waiting for me, completed or cancelled, with the step each one is at. */
export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const [l, c, me] = await Promise.all([
    getTranslations('lifecycle'),
    getTranslations('common'),
    getMe(),
  ]);
  const status = sp.status ?? 'open';
  const qs = new URLSearchParams({ size: '200' });
  if (status === 'mine') qs.set('mine', 'true');
  else qs.set('status', status);
  if (sp.q) qs.set('q', sp.q);
  const list = await apiFetch<Page<Withdrawal>>(`/people/withdrawals?${qs.toString()}`);
  const canManage = me.permissions.includes('people.withdrawal.manage');
  return (
    <>
      <PageHeader
        kicker="People"
        title="Withdrawals"
        description="Students leaving the school: each department clears them step by step, then the TC and completion."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/people/withdrawals/bulk">
              Bulk (class XII)
            </a>
            {canManage ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/withdrawals/settings">
                Departments and steps
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
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
              { value: 'mine', label: 'Waiting for me' },
              { value: 'completed', label: l('withdrawalStatuses.completed') },
              { value: 'cancelled', label: l('withdrawalStatuses.cancelled') },
            ]}
          />
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Student or admission no</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<Withdrawal>
          caption="Withdrawals"
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
            { key: 'section', header: 'Class', render: (w) => w.section ?? '' },
            { key: 'started', header: 'Started', render: (w) => w.initiatedOn },
            { key: 'leaving', header: l('leavingOn'), render: (w) => w.leavingOn },
            { key: 'reason', header: l('reason'), render: (w) => w.reason },
            {
              key: 'progress',
              header: 'Departments',
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
                            : x.step === w.currentStep
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {x.departmentName}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'tc',
              header: 'TC',
              render: (w) => (w.tc ? w.tc.tcNo : w.canIssueTc ? 'ready' : '—'),
            },
            {
              key: 'status',
              header: l('status'),
              render: (w) => (
                <Badge tone={tone(w.status)}>
                  {l(`withdrawalStatuses.${w.status}`)}
                  {w.status === 'requested' && w.currentStep
                    ? ` · step ${String(w.currentStep)}`
                    : ''}
                </Badge>
              ),
            },
          ]}
          rows={list.data}
          rowKey={(w) => w.id}
          emptyTitle={status === 'mine' ? 'Nothing is waiting for you.' : l('noWithdrawals')}
        />
      </Card>
    </>
  );
}
