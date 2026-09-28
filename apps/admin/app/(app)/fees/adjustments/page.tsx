import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideAdjustment, decideProfileChange } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeAdjustment, FeeProfileChange } from '@/lib/types';

const tone = (s: FeeAdjustment['status']) =>
  s === 'approved'
    ? 'success'
    : s === 'rejected'
      ? 'danger'
      : s === 'pending'
        ? 'warning'
        : 'neutral';

/** Sprint 14: adjustments (waiver, reversal, bounce) and category/discount changes with their decisions. */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.status ? `?status=${sp.status}` : '';
  const [t, a, f, me, adjustments, changes] = await Promise.all([
    getTranslations('pages.fees_adjustments'),
    getTranslations('adjustments'),
    getTranslations('fees'),
    getMe(),
    apiFetch<{ data: FeeAdjustment[] }>(`/fees/adjustments${q}`).then((r) => r.data),
    apiFetch<{ data: FeeProfileChange[] }>(`/fees/profile-changes${q}`)
      .then((r) => r.data)
      .catch(() => [] as FeeProfileChange[]),
  ]);
  const canApprove = me.permissions.includes('fees.adjustment.approve');
  const canDecideChange = me.permissions.includes('fees.profile.manage');
  const describe = (c: FeeProfileChange) =>
    Object.entries(c.changes)
      .map(([k, v]) => {
        if (k === 'discountId') return `${a('discount')}: ${v === null ? f('none') : String(v)}`;
        if (k === 'hosteller') return `${a('hosteller')}: ${v ? a('yes') : a('no')}`;
        if (k === 'studentType') return `${a('studentType')}: ${String(v)}`;
        if (k === 'feeGroup') return `${a('feeGroup')}: ${String(v)}`;
        return `${k}: ${String(v)}`;
      })
      .join(' · ');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <SelectField
          id="status"
          name="status"
          label={a('status')}
          defaultValue={sp.status ?? ''}
          options={[
            { value: '', label: a('all') },
            ...(['pending', 'approved', 'rejected'] as const).map((s) => ({
              value: s,
              label: a(`statuses.${s}`),
            })),
          ]}
        />
        <Button type="submit" variant="secondary">
          {a('filter')}
        </Button>
      </form>
      <Card title={t('title')}>
        <p className="ep-field__help">{a('help')}</p>
        <DataTable<FeeAdjustment>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'when',
              header: a('requestedAt'),
              render: (x) => new Date(x.requestedAt).toLocaleString('en-IN'),
            },
            {
              key: 'student',
              header: a('student'),
              render: (x) => (
                <a href={`/fees/ledger/${x.studentId}`}>
                  {x.studentName} · {x.admissionNo}
                </a>
              ),
            },
            {
              key: 'kind',
              header: a('kind'),
              render: (x) => <strong>{a(`kinds.${x.kind}`)}</strong>,
            },
            {
              key: 'on',
              header: a('receipt'),
              render: (x) =>
                x.kind === 'waiver'
                  ? (x.demandLabel ?? x.demandId)
                  : `${x.receiptNo ?? ''} (₹${x.receiptAmount ?? ''})`,
            },
            { key: 'amount', header: a('amount'), numeric: true, render: (x) => `₹${x.amount}` },
            {
              key: 'charge',
              header: a('charge'),
              numeric: true,
              render: (x) => (Number(x.charge) > 0 ? `₹${x.charge}` : '—'),
            },
            { key: 'reason', header: a('reason'), render: (x) => x.reason },
            {
              key: 'status',
              header: a('status'),
              render: (x) => (
                <span title={x.decisionNote ?? ''}>
                  <Badge tone={tone(x.status)}>{a(`statuses.${x.status}`)}</Badge>
                  {x.decidedBy ? <small> · {x.decidedBy}</small> : null}
                </span>
              ),
            },
            {
              key: 'decide',
              header: canApprove ? a('decide') : '',
              render: (x) =>
                canApprove && x.status === 'pending' ? (
                  <form
                    action={decideAdjustment}
                    style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 220 }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <InputField id={`note-${x.id}`} name="note" label={a('note')} maxLength={300} />
                    <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      <Button type="submit" name="outcome" value="approved" size="sm">
                        {a('approve')}
                      </Button>
                      <Button
                        type="submit"
                        name="outcome"
                        value="rejected"
                        variant="secondary"
                        size="sm"
                      >
                        {a('reject')}
                      </Button>
                    </div>
                  </form>
                ) : null,
            },
          ]}
          rows={adjustments}
          rowKey={(x) => x.id}
          emptyTitle={a('noAdjustments')}
        />
      </Card>
      <Card title={a('profileChanges')} style={{ marginTop: 'var(--sp-4)' }}>
        <DataTable<FeeProfileChange>
          caption={a('profileChanges')}
          density="dense"
          columns={[
            {
              key: 'when',
              header: a('requestedAt'),
              render: (x) => new Date(x.requestedAt).toLocaleString('en-IN'),
            },
            {
              key: 'student',
              header: a('student'),
              render: (x) => (
                <a href={`/people/students/${x.studentId}`}>
                  {x.studentName} · {x.admissionNo}
                </a>
              ),
            },
            { key: 'changes', header: a('changes'), render: (x) => describe(x) },
            { key: 'reason', header: a('reason'), render: (x) => x.reason },
            {
              key: 'status',
              header: a('status'),
              render: (x) => (
                <span title={x.decisionNote ?? ''}>
                  <Badge tone={tone(x.status)}>{a(`statuses.${x.status}`)}</Badge>
                  {x.status === 'pending' && x.workflowInstanceId ? (
                    <small>
                      {' '}
                      · <a href="/workflow/inbox">{a('inWorkflow')}</a>
                    </small>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'decide',
              header: canDecideChange ? a('decide') : '',
              render: (x) =>
                canDecideChange && x.status === 'pending' && !x.workflowInstanceId ? (
                  <form
                    action={decideProfileChange}
                    style={{ display: 'flex', gap: 'var(--sp-2)' }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <Button type="submit" name="outcome" value="approved" size="sm">
                      {a('statuses.approved')}
                    </Button>
                    <Button
                      type="submit"
                      name="outcome"
                      value="rejected"
                      variant="secondary"
                      size="sm"
                    >
                      {a('reject')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={changes}
          rowKey={(x) => x.id}
          emptyTitle={a('noChanges')}
        />
      </Card>
    </>
  );
}
