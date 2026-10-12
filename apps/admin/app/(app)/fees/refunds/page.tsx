import { decideRefund__outcome } from '@/lib/choice-actions';
import { NoEnterSubmit } from '@/components/NoEnterSubmit';
import { makeRefundFeeDue } from '@/lib/fee-request-actions';
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
import {
  FilterInput,
  FilterRow,
  Pager,
  RegisterBar,
  registerQuery,
  rupees,
} from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeRefund, Page } from '@/lib/types';

/** A refund as it was raised: one row even when it draws on several receipts. */
type RefundRow = FeeRefund & {
  receipts: string[];
  parts: number;
  origin: 'receipt' | 'pupil' | 'withdrawal' | 'advance';
};
const ORIGIN: Record<RefundRow['origin'], string> = {
  receipt: 'One receipt',
  pupil: 'Pupil (many receipts)',
  withdrawal: 'Withdrawal',
  advance: 'Advance from last year',
};
const STATUSES = ['draft', 'requested', 'approved', 'paid', 'rejected', 'failed'];

const tone = (s: FeeRefund['status']) =>
  s === 'paid' || s === 'approved'
    ? 'success'
    : s === 'rejected' || s === 'failed'
      ? 'danger'
      : 'warning';

/** The refund register: filters, totals, pages, Excel and PDF; decisions where no approval level is set. */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const rq = registerQuery(sp, {
    status: STATUSES,
    kind: ['receipt', 'pupil', 'withdrawal', 'advance'],
    mode: ['cash', 'bank', 'cheque', 'gateway'],
  });
  const [t, r, me, refunds, classes] = await Promise.all([
    getTranslations('pages.fees_refunds'),
    getTranslations('refunds'),
    getMe(),
    apiFetch<
      Page<RefundRow> & {
        totals: { paid: string; waiting: string; draft: string; rejected: string };
      }
    >(`/payments/refunds/register?${rq.list.toString()}`),
    apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
      .then((x) => x.data)
      .catch(() => []),
  ]);
  const canDecide = me.permissions.includes('fees.refund.approve');
  const size = Number(rq.size);
  const pages = Math.max(1, Math.ceil(refunds.page.total / size));
  const page = Math.min(refunds.page.number, pages);
  const back = `/fees/refunds?${rq.here({})}`;
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <FilterRow clearHref="/fees/refunds">
          <SelectField
            id="status"
            name="status"
            label={r('status')}
            defaultValue={rq.values.status}
            options={[
              { value: '', label: r('all') },
              ...STATUSES.map((s) => ({ value: s, label: r(`statuses.${s}`) })),
            ]}
          />
          <SelectField
            id="kind"
            name="kind"
            label="Type"
            defaultValue={rq.values.kind}
            options={[
              { value: '', label: 'All types' },
              ...Object.entries(ORIGIN).map(([value, label]) => ({ value, label })),
            ]}
          />
          <SelectField
            id="mode"
            name="mode"
            label="Paid back by"
            defaultValue={rq.values.mode}
            options={[
              { value: '', label: 'Any mode' },
              ...(['bank', 'cheque', 'cash', 'gateway'] as const).map((m) => ({
                value: m,
                label: r(`modes.${m}`),
              })),
            ]}
          />
          <SelectField
            id="classId"
            name="classId"
            label="Class"
            defaultValue={rq.values.classId}
            options={[
              { value: '', label: 'All classes' },
              ...classes.map((k) => ({ value: k.id, label: k.name || k.code })),
            ]}
          />
          <FilterInput id="from" label="Asked from" type="date" value={rq.values.from} />
          <FilterInput id="to" label="Asked to" type="date" value={rq.values.to} />
          <FilterInput id="q" label="Student, receipt or voucher no." value={rq.values.q} />
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={rq.size}
            options={['25', '50', '100', '200'].map((n) => ({ value: n, label: n }))}
          />
        </FilterRow>
        <RegisterBar
          page={page}
          size={size}
          total={refunds.page.total}
          summary={`Paid ${rupees(refunds.totals.paid)} · Waiting ${rupees(refunds.totals.waiting)} · Draft ${rupees(refunds.totals.draft)} · Rejected ${rupees(refunds.totals.rejected)}`}
          fileHref={`/api/fees/register-file?register=refunds&${rq.filters.toString()}`}
        />
        <p className="ep-field__help">{r('requestHelp')}</p>
        <DataTable<RefundRow>
          caption={`${r('refunds')} · ${refunds.page.total}`}
          density="dense"
          columns={[
            {
              key: 'when',
              header: r('requestedAt'),
              render: (x) =>
                new Date(x.requestedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
            },
            {
              key: 'voucher',
              header: 'Voucher',
              render: (x) => <a href={`/fees/refund-voucher/${x.id}`}>{x.voucherNo ?? 'Open'}</a>,
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
              render: (x) => (
                <>
                  <strong>{ORIGIN[x.origin]}</strong>
                  {x.receipts.length > 0 ? (
                    <div>
                      {x.receipts.slice(0, 3).join(', ')}
                      {x.receipts.length > 3 ? ` +${String(x.receipts.length - 3)} more` : ''}
                    </div>
                  ) : null}
                  {x.lines && x.kind !== 'opening_advance' ? (
                    <div className="ep-field__help">
                      {x.lines
                        .slice(0, 4)
                        .map((l) => `${l.head}${l.period ? ` ${l.period.split(' ')[0]}` : ''}`)
                        .join(', ')}
                      {x.lines.length > 4 ? ` +${x.lines.length - 4} more` : ''} ·{' '}
                      {x.feeAction === 'cancel' ? 'fee cancelled' : 'fee stays due'}
                    </div>
                  ) : null}
                </>
              ),
            },
            { key: 'amount', header: r('amount'), numeric: true, render: (x) => rupees(x.amount) },
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
                  {x.status === 'requested' && x.waitingWith ? (
                    <div className="ep-field__help">with {x.waitingWith}</div>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'decide',
              header: canDecide ? r('decide') : '',
              render: (x) =>
                x.status === 'draft' ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/fees/refund-voucher/${x.id}`}
                  >
                    Print, send or discard
                  </a>
                ) : x.status === 'requested' && x.workflowInstanceId ? (
                  <a href="/workflow/inbox">Approve in My approvals</a>
                ) : canDecide &&
                  x.status === 'paid' &&
                  x.feeAction === 'cancel' &&
                  x.lines &&
                  x.kind !== 'opening_advance' &&
                  !x.withdrawalId ? (
                  <details>
                    <summary>Fee was cancelled by mistake?</summary>
                    <form
                      action={makeRefundFeeDue}
                      style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 240 }}
                    >
                      <input type="hidden" name="id" value={x.id} />
                      <InputField
                        id={`due-${x.id}`}
                        name="reason"
                        label="Reason"
                        required
                        minLength={3}
                        maxLength={300}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Make the fee due again
                      </Button>
                    </form>
                  </details>
                ) : canDecide && x.status === 'requested' ? (
                  <form
                    action={decideRefund}
                    style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 260 }}
                  >
                    <NoEnterSubmit />
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="back" value={back} />
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
                      <Button
                        type="submit"
                        formAction={decideRefund__outcome.bind(null, 'approved')}
                        size="sm"
                      >
                        {r('approve')}
                      </Button>
                      <Button
                        type="submit"
                        formAction={decideRefund__outcome.bind(null, 'rejected')}
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
        <Pager page={page} pages={pages} hrefFor={(n) => `?${rq.here({ page: String(n) })}`} />
      </Card>
    </>
  );
}
