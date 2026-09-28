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
import { decideRefund } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeRefund, Page } from '@/lib/types';

const tone = (s: FeeRefund['status']) =>
  s === 'paid' || s === 'approved'
    ? 'success'
    : s === 'rejected' || s === 'failed'
      ? 'danger'
      : 'warning';

/** Sprint 13: refund requests and their decisions. */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '100' });
  if (sp.status) q.set('status', sp.status);
  const [t, r, me, refunds] = await Promise.all([
    getTranslations('pages.fees_refunds'),
    getTranslations('refunds'),
    getMe(),
    apiFetch<Page<FeeRefund>>(`/payments/refunds?${q.toString()}`),
  ]);
  const canDecide = me.permissions.includes('fees.refund.approve');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={r('refunds')}>
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
            label={r('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: r('all') },
              ...(['requested', 'approved', 'paid', 'rejected', 'failed'] as const).map((s) => ({
                value: s,
                label: r(`statuses.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {r('filter')}
          </Button>
        </form>
        <p className="ep-field__help">{r('requestHelp')}</p>
        <DataTable<FeeRefund>
          caption={`${r('refunds')} · ${refunds.page.total}`}
          density="dense"
          columns={[
            {
              key: 'when',
              header: r('requestedAt'),
              render: (x) => new Date(x.requestedAt).toLocaleString('en-IN'),
            },
            {
              key: 'student',
              header: r('student'),
              render: (x) => (
                <a href={`/fees/ledger/${x.studentId}`}>
                  {x.studentName} · {x.admissionNo}
                </a>
              ),
            },
            {
              key: 'receipt',
              header: r('receipt'),
              render: (x) => `${x.receiptNo ?? '—'} (₹${x.receiptAmount})`,
            },
            { key: 'amount', header: r('amount'), numeric: true, render: (x) => `₹${x.amount}` },
            {
              key: 'mode',
              header: r('mode'),
              render: (x) => `${r(`modes.${x.mode}`)}${x.reference ? ` · ${x.reference}` : ''}`,
            },
            { key: 'reason', header: r('reason'), render: (x) => x.reason },
            {
              key: 'status',
              header: r('status'),
              render: (x) => (
                <span title={x.decisionNote ?? ''}>
                  <Badge tone={tone(x.status)}>{r(`statuses.${x.status}`)}</Badge>
                  {x.decidedBy ? <small> · {x.decidedBy}</small> : null}
                </span>
              ),
            },
            {
              key: 'decide',
              header: canDecide ? r('decide') : '',
              render: (x) =>
                canDecide && x.status === 'requested' ? (
                  <form
                    action={decideRefund}
                    style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 260 }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <input
                      type="hidden"
                      name="back"
                      value={`/fees/refunds${sp.status ? `?status=${sp.status}` : ''}`}
                    />
                    <FormRow columns={2}>
                      <InputField
                        id={`ref-${x.id}`}
                        name="reference"
                        label={r('reference')}
                        maxLength={80}
                      />
                      <InputField
                        id={`note-${x.id}`}
                        name="note"
                        label={r('note')}
                        maxLength={300}
                      />
                    </FormRow>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      <Button type="submit" name="outcome" value="approved" size="sm">
                        {r('approve')}
                      </Button>
                      <Button
                        type="submit"
                        name="outcome"
                        value="rejected"
                        variant="secondary"
                        size="sm"
                      >
                        {r('reject')}
                      </Button>
                    </div>
                  </form>
                ) : null,
            },
          ]}
          rows={refunds.data}
          rowKey={(x) => x.id}
          emptyTitle={r('noRefunds')}
        />
      </Card>
    </>
  );
}
