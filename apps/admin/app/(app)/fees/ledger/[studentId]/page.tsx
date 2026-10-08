import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  queueReceiptPdf,
  recordLedgerPayment,
  regenerateStudentDemand,
  requestAdjustment,
  requestRefund,
  revokeLateFeeOverride,
  setLateFeeOverride,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type {
  FeeDemandSummary,
  FeeLedger,
  FeeLedgerInstalment,
  FeeLedgerPayment,
} from '@/lib/types';

const toneFor = (s: FeeLedgerInstalment['status']) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';

/** Sprint 12: the student fee ledger (instalments, late fee, receipts, overrides, regeneration diff). */
export default async function FeeLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; asOf?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const [t, f, c, me] = await Promise.all([
    getTranslations('pages.fees_ledger'),
    getTranslations('fees'),
    getTranslations('common'),
    getMe(),
  ]);
  const can = (p: string) => me.permissions.includes(p);
  const ledger = await apiFetch<FeeLedger>(
    `/fees/students/${studentId}/ledger${sp.asOf ? `?asOf=${sp.asOf}` : ''}`,
  );
  const demandRows = can('fees.adjustment.request')
    ? await apiFetch<FeeDemandSummary>(`/fees/students/${studentId}/demands`)
        .then((d) => d.rows.filter((r) => Number(r.net) - Number(r.paid) > 0))
        .catch(() => [])
    : [];
  const yearOpen = ledger.year.status === 'active';
  const diff = ledger.lastRun?.diff ?? null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/fees/demands' },
          { label: ledger.student.name, href: `/people/students/${ledger.student.id}` },
          { label: t('title') },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${ledger.student.name} · ${ledger.student.admissionNo}`}
        description={`${ledger.student.section ?? ''} · ${ledger.year.code} (${ledger.year.status}) · ${f('lateFeeMode')}: ${f(`modes.${ledger.lateFeeMode === 'daywise' || ledger.lateFeeMode === 'slab' ? ledger.lateFeeMode : 'none'}`)}`}
        actions={
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/bills?studentId=${studentId}`}
            >
              Fee bill
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/tax-certificate/${studentId}`}
            >
              Tax certificate
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/fees/fnf/${studentId}`}>
              Provisional bill (withdrawal)
            </a>
            <InputField
              id="asOf"
              name="asOf"
              label={f('asOf')}
              type="date"
              defaultValue={ledger.asOf}
            />
            <Button type="submit" variant="secondary">
              {c('apply')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {(
          [
            ['net', ledger.totals.net],
            ['paid', ledger.totals.paid],
            ['balance', ledger.totals.balance],
            ['lateFee', ledger.totals.lateFee],
            ['lateFeePosted', ledger.totals.lateFeePosted],
            ['lateFeeOutstanding', ledger.totals.lateFeeOutstanding],
            ['payable', ledger.totals.payable],
          ] as const
        ).map(([k, v]) => (
          <Card key={k} elevated>
            <div className="ep-kicker">{f(k)}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--fs-h2)',
                fontWeight: 600,
              }}
            >
              ₹{v}
            </div>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={f('instalmentsTitle')}>
          <DataTable<FeeLedgerInstalment>
            caption={f('instalmentsTitle')}
            density="dense"
            columns={[
              { key: 'label', header: f('instalment'), render: (x) => <strong>{x.label}</strong> },
              { key: 'due', header: f('dueOn'), render: (x) => x.dueOn },
              { key: 'ledger', header: f('ledgerCol'), render: (x) => f(`ledgers.${x.ledger}`) },
              { key: 'net', header: f('net'), numeric: true, render: (x) => x.net },
              { key: 'paid', header: f('paid'), numeric: true, render: (x) => x.paid },
              { key: 'bal', header: f('balance'), numeric: true, render: (x) => x.balance },
              {
                key: 'late',
                header: f('lateFee'),
                numeric: true,
                render: (x) =>
                  Number(x.lateFee.amount) > 0 || x.lateFee.overridden ? (
                    <span title={x.lateFee.reason ?? ''}>
                      {x.lateFee.amount}{' '}
                      <small>
                        ({f(`modes.${x.lateFee.mode}`)}
                        {x.lateFee.mode === 'daywise' ? ` · ${x.lateFee.days} ${f('days')}` : ''})
                      </small>
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'status',
                header: c('status'),
                render: (x) => (
                  <Badge tone={toneFor(x.status)}>
                    {f(`statuses.${x.status}`)}
                    {!x.visible ? ` · ${f('hidden')}` : ''}
                  </Badge>
                ),
              },
              { key: 'vis', header: f('visibleFrom'), render: (x) => x.visibleFrom },
            ]}
            rows={ledger.instalments}
            rowKey={(x) => `${x.ledger}-${x.dueOn}`}
            emptyTitle={f('noInstalments')}
          />
          {can('fees.demand.generate') && yearOpen ? (
            <form action={regenerateStudentDemand} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="studentId" value={studentId} />
              <p className="ep-field__help">{f('regenerateHelp')}</p>
              <Button type="submit" variant="secondary">
                {f('regenerateDiff')}
              </Button>
            </form>
          ) : null}
          {ledger.lastRun ? (
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {f('lastDiff')}: {new Date(ledger.lastRun.ranAt).toLocaleString('en-IN')}{' '}
              {ledger.lastRun.ranBy ? `(${ledger.lastRun.ranBy})` : ''}
              {diff
                ? ` · ${f('added')} ${diff.added.length} · ${f('removed')} ${diff.removed.length} · ${f('changed')} ${diff.changed.length} · ${diff.kept} ${f('kept')} · ₹${diff.totalBefore} ${f('totalBefore')} → ₹${diff.totalAfter} ${f('totalAfter')}`
                : ''}
            </p>
          ) : null}
          {diff && (diff.added.length || diff.removed.length || diff.changed.length) ? (
            <DataTable<{ kind: string; period: string; head: string; detail: string }>
              caption={f('lastDiff')}
              density="dense"
              columns={[
                {
                  key: 'kind',
                  header: '',
                  render: (x) => (
                    <Badge
                      tone={
                        x.kind === 'added' ? 'success' : x.kind === 'removed' ? 'danger' : 'warning'
                      }
                    >
                      {f(x.kind)}
                    </Badge>
                  ),
                },
                { key: 'period', header: f('period'), render: (x) => x.period },
                { key: 'head', header: f('head'), render: (x) => x.head },
                { key: 'detail', header: f('net'), render: (x) => x.detail },
              ]}
              rows={[
                ...diff.added.map((x) => ({
                  kind: 'added',
                  period: x.period,
                  head: x.head,
                  detail: `${x.net} · ${x.dueOn}`,
                })),
                ...diff.removed.map((x) => ({
                  kind: 'removed',
                  period: x.period,
                  head: x.head,
                  detail: `${x.net} · ${x.dueOn}`,
                })),
                ...diff.changed.map((x) => ({
                  kind: 'changed',
                  period: x.period,
                  head: x.head,
                  detail: `${x.before.net} (${x.before.dueOn}) → ${x.after.net} (${x.after.dueOn})`,
                })),
              ]}
              rowKey={(x) => `${x.kind}-${x.period}-${x.head}`}
              emptyTitle={f('noDiff')}
            />
          ) : null}
        </Card>

        <Card title={f('receipts')}>
          <DataTable<FeeLedgerPayment>
            caption={f('receipts')}
            density="dense"
            columns={[
              {
                key: 'no',
                header: f('receiptNo'),
                render: (p) => <strong>{p.receiptNo ?? '—'}</strong>,
              },
              { key: 'on', header: f('receivedOn'), render: (p) => p.receivedOn },
              { key: 'amount', header: f('amount'), numeric: true, render: (p) => p.amount },
              {
                key: 'lf',
                header: f('receiptLateFee'),
                numeric: true,
                render: (p) => (Number(p.lateFee) > 0 ? p.lateFee : '—'),
              },
              {
                key: 'mode',
                header: f('mode'),
                render: (p) =>
                  `${p.mode}${p.instrumentNo ? ` · ${p.instrumentNo}` : ''}${p.bankName ? ` · ${p.bankName}` : ''}${p.reference ? ` · ${p.reference}` : ''}`,
              },
              {
                key: 'st',
                header: f('receiptStatus'),
                render: (p) => (
                  <Badge
                    tone={
                      p.status === 'posted'
                        ? 'success'
                        : p.status === 'bounced'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {f(`receiptStatuses.${p.status}`)}
                    {Number(p.refunded) > 0 ? ` · ${p.refunded}` : ''}
                    {p.settled ? ` · ${f('settled')}` : ''}
                  </Badge>
                ),
              },
              {
                key: 'adv',
                header: f('unallocated'),
                numeric: true,
                render: (p) => (Number(p.unallocated) > 0 ? p.unallocated : '—'),
              },
              { key: 'by', header: f('receivedBy'), render: (p) => p.receivedBy ?? '' },
              {
                key: 'pdf',
                header: '',
                render: (p) => (
                  <form action={queueReceiptPdf}>
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {f('receiptPdf')}
                    </Button>
                  </form>
                ),
              },
            ]}
            rows={ledger.payments}
            rowKey={(p) => p.id}
            emptyTitle={f('noPayments')}
          />
          {can('fees.receipt.post') && yearOpen ? (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/fees/cashier?studentId=${studentId}`}
              >
                {f('openCashier')}
              </a>
            </p>
          ) : null}
          {can('fees.adjustment.request') && yearOpen ? (
            <div style={{ marginTop: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}>
              {demandRows.length ? (
                <form action={requestAdjustment}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="kind" value="waiver" />
                  <p className="ep-field__help">{f('requestWaiver')}</p>
                  <FormRow columns={3}>
                    <SelectField
                      id="waiverDemand"
                      name="demandId"
                      label={f('head')}
                      options={demandRows.map((r) => ({
                        value: r.id,
                        label: `${r.periodName} · ${r.headName} · ₹${(Number(r.net) - Number(r.paid)).toFixed(2)}`,
                      }))}
                    />
                    <InputField
                      id="waiverAmount"
                      name="amount"
                      label={f('amount')}
                      type="number"
                      min={1}
                      step="0.01"
                      required
                    />
                    <InputField
                      id="waiverReason"
                      name="reason"
                      label={f('reason')}
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </FormRow>
                  <FormActions>
                    <Button type="submit" variant="secondary">
                      {f('requestWaiver')}
                    </Button>
                  </FormActions>
                </form>
              ) : null}
              {ledger.payments.some((p) => p.status === 'posted') ? (
                <form action={requestAdjustment}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <p className="ep-field__help">{f('requestReversal')}</p>
                  <FormRow columns={4}>
                    <SelectField
                      id="revPayment"
                      name="paymentId"
                      label={f('receiptNo')}
                      options={ledger.payments
                        .filter((p) => p.status === 'posted')
                        .map((p) => ({
                          value: p.id,
                          label: `${p.receiptNo ?? p.id} · ₹${p.amount} · ${p.mode}`,
                        }))}
                    />
                    <SelectField
                      id="revKind"
                      name="kind"
                      label={f('mode')}
                      options={[
                        { value: 'reversal', label: f('requestReversal') },
                        { value: 'bounce', label: f('requestBounce') },
                      ]}
                    />
                    <InputField
                      id="revCharge"
                      name="charge"
                      label={f('lateFee')}
                      type="number"
                      min={0}
                      step="0.01"
                    />
                    <InputField
                      id="revReason"
                      name="reason"
                      label={f('reason')}
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </FormRow>
                  <FormActions>
                    <Button type="submit" variant="secondary">
                      {f('requestReversal')}
                    </Button>
                  </FormActions>
                </form>
              ) : null}
            </div>
          ) : null}
          {can('fees.refund.request') && yearOpen && ledger.payments.length ? (
            <form action={requestRefund} style={{ marginTop: 'var(--sp-4)' }}>
              <input type="hidden" name="studentId" value={studentId} />
              <p className="ep-field__help">{f('refunds')}</p>
              <FormRow columns={4}>
                <SelectField
                  id="refundPayment"
                  name="paymentId"
                  label={f('receiptNo')}
                  options={ledger.payments
                    .filter((p) => Number(p.amount) - Number(p.refunded) > 0)
                    .map((p) => ({ value: p.id, label: `${p.receiptNo ?? p.id} · ₹${p.amount}` }))}
                />
                <InputField
                  id="refundAmount"
                  name="amount"
                  label={f('amount')}
                  type="number"
                  min={1}
                  step="0.01"
                  required
                />
                <SelectField
                  id="refundMode"
                  name="mode"
                  label={f('mode')}
                  options={['bank', 'cash', 'cheque', 'gateway'].map((m) => ({
                    value: m,
                    label: m.toUpperCase(),
                  }))}
                />
                <InputField
                  id="refundReason"
                  name="reason"
                  label={f('reason')}
                  required
                  minLength={3}
                  maxLength={300}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('refunds')}
                </Button>
              </FormActions>
            </form>
          ) : null}
          {ledger.refunds.length ? (
            <DataTable<FeeLedger['refunds'][number]>
              caption={f('refunds')}
              density="dense"
              columns={[
                { key: 'no', header: f('receiptNo'), render: (r) => r.receiptNo ?? '—' },
                { key: 'amount', header: f('amount'), numeric: true, render: (r) => r.amount },
                { key: 'mode', header: f('mode'), render: (r) => r.mode },
                { key: 'reason', header: f('reason'), render: (r) => r.reason },
                {
                  key: 'status',
                  header: f('receiptStatus'),
                  render: (r) => (
                    <Badge
                      tone={
                        r.status === 'paid'
                          ? 'success'
                          : r.status === 'rejected' || r.status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {r.status}
                    </Badge>
                  ),
                },
              ]}
              rows={ledger.refunds}
              rowKey={(r) => r.id}
              emptyTitle={f('noRefunds')}
            />
          ) : null}
          {can('payments.offline.record') && yearOpen ? (
            <form action={recordLedgerPayment} style={{ marginTop: 'var(--sp-4)' }}>
              <input type="hidden" name="studentId" value={studentId} />
              <p className="ep-field__help">{f('recordPayment')}</p>
              <FormRow columns={4}>
                <InputField
                  id="amount"
                  name="amount"
                  label={f('amount')}
                  type="number"
                  min={1}
                  step="0.01"
                  required
                />
                <SelectField
                  id="mode"
                  name="mode"
                  label={f('mode')}
                  options={['cash', 'cheque', 'upi', 'bank'].map((m) => ({
                    value: m,
                    label: m.toUpperCase(),
                  }))}
                />
                <InputField id="receivedOn" name="receivedOn" label={f('receivedOn')} type="date" />
                <InputField id="reference" name="reference" label={f('reference')} maxLength={80} />
              </FormRow>
              <FormActions>
                <Button type="submit">{f('recordPayment')}</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>

        {can('fees.late_fee.manage') ? (
          <Card title={f('overrides')}>
            <DataTable<FeeLedger['overrides'][number]>
              caption={f('overrides')}
              density="dense"
              columns={[
                { key: 'period', header: f('period'), render: (o) => o.periodName },
                { key: 'amount', header: f('lateFee'), numeric: true, render: (o) => o.amount },
                { key: 'reason', header: f('reason'), render: (o) => o.reason },
                { key: 'by', header: f('receivedBy'), render: (o) => o.createdBy ?? '' },
                {
                  key: 'revoke',
                  header: '',
                  render: (o) =>
                    yearOpen ? (
                      <form action={revokeLateFeeOverride}>
                        <input type="hidden" name="studentId" value={studentId} />
                        <input type="hidden" name="overrideId" value={o.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {f('revoke')}
                        </Button>
                      </form>
                    ) : null,
                },
              ]}
              rows={ledger.overrides}
              rowKey={(o) => o.id}
              emptyTitle={f('noOverrides')}
            />
            {yearOpen && ledger.instalments.some((x) => x.lateFee.periodId) ? (
              <form action={setLateFeeOverride} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="studentId" value={studentId} />
                <FormRow columns={3}>
                  <SelectField
                    id="periodId"
                    name="periodId"
                    label={f('instalment')}
                    options={ledger.instalments
                      .filter((x) => x.lateFee.periodId)
                      .map((x) => ({
                        value: x.lateFee.periodId as string,
                        label: `${x.label} · ${x.dueOn}`,
                      }))}
                  />
                  <InputField
                    id="amount"
                    name="amount"
                    label={f('overrideAmount')}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={0}
                  />
                  <InputField
                    id="reason"
                    name="reason"
                    label={f('reason')}
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {f('setLateFee')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
