import {
  Alert,
  Badge,
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
import { postCashierReceipt, queueCashierReceiptPdf } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { FeeLedger, FeeLedgerInstalment, FeeLedgerPayment, Page, Student } from '@/lib/types';

const toneFor = (s: FeeLedgerInstalment['status']) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';

/** Sprint 13: the cashier screen. Find the student, read what is payable, post the receipt, print it. */
export default async function CashierPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classSectionId?: string;
    studentId?: string;
    paymentId?: string;
    receiptNo?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, k, f, me, sections] = await Promise.all([
    getTranslations('pages.fees_cashier'),
    getTranslations('cashier'),
    getTranslations('fees'),
    getMe(),
    sectionOptions(),
  ]);
  const students = sp.classSectionId
    ? await apiFetch<Page<Student>>(
        `/people/students?classSectionId=${sp.classSectionId}&size=200`,
      ).then((r) => r.data)
    : [];
  const ledger = sp.studentId
    ? await apiFetch<FeeLedger>(`/fees/students/${sp.studentId}/ledger`).catch(() => null)
    : null;
  const canWaive = me.permissions.includes('fees.late_fee.manage');
  // the payment mode master: what the counter accepts and what each mode needs filled
  const counterModes = await apiFetch<{
    data: Array<{
      code: string;
      kind: string;
      label: string;
      atCounter: boolean;
      needReference: boolean;
      needInstrumentNo: boolean;
      needInstrumentDate: boolean;
      needBank: boolean;
    }>;
  }>('/fees/payment-modes')
    .then((r) => r.data.filter((m) => m.atCounter))
    .catch(() => []);
  const modeHelp = counterModes
    .map((m) => {
      const need = [
        m.needReference ? 'reference no.' : '',
        m.needInstrumentNo ? 'cheque/DD no.' : '',
        m.needInstrumentDate ? 'cheque/DD date' : '',
        m.needBank ? 'bank name' : '',
      ].filter(Boolean);
      return need.length > 0 ? `${m.label}: ${need.join(', ')}` : '';
    })
    .filter(Boolean)
    .join(' · ');
  const yearOpen = ledger?.year.status === 'active';
  const posted = ledger?.payments.find((p) => p.id === sp.paymentId) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {sp.ok && posted ? (
        <Alert tone="success">
          <strong>{k('posted')}</strong> · {k('receiptNo')} <code>{posted.receiptNo ?? '—'}</code> ·{' '}
          {k('amount')} ₹{posted.amount} · {k('lateFee')} ₹{posted.lateFee}
          {Number(posted.unallocated) > 0 ? ` · ${k('advance')} ₹${posted.unallocated}` : ''}
          <form
            action={queueCashierReceiptPdf}
            style={{ display: 'inline', marginLeft: 'var(--sp-3)' }}
          >
            <input type="hidden" name="studentId" value={sp.studentId ?? ''} />
            <input type="hidden" name="paymentId" value={posted.id} />
            <Button type="submit" variant="secondary" size="sm">
              {k('printReceipt')}
            </Button>
          </form>
        </Alert>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
          marginTop: 'var(--sp-4)',
        }}
      >
        <Card title={k('findStudent')}>
          <form method="get" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <SelectField
              id="classSectionId"
              name="classSectionId"
              label={k('section')}
              defaultValue={sp.classSectionId ?? ''}
              options={[{ value: '', label: '—' }, ...sections]}
            />
            {students.length ? (
              <SelectField
                id="studentId"
                name="studentId"
                label={k('student')}
                defaultValue={sp.studentId ?? ''}
                options={[
                  { value: '', label: '—' },
                  ...students.map((s) => ({
                    value: s.id,
                    label: `${s.displayName} · ${s.admissionNo}`,
                  })),
                ]}
              />
            ) : null}
            <FormActions>
              <Button type="submit" variant="secondary">
                {k('findStudent')}
              </Button>
            </FormActions>
          </form>
          {!ledger ? <p className="ep-field__help">{k('noStudent')}</p> : null}
          {ledger ? (
            <>
              <h3
                style={{ fontFamily: 'var(--font-heading)', margin: 'var(--sp-4) 0 var(--sp-2)' }}
              >
                {ledger.student.name} · {ledger.student.admissionNo}
                {ledger.student.section ? ` · ${ledger.student.section}` : ''}
              </h3>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-2)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  marginBottom: 'var(--sp-3)',
                }}
              >
                {(
                  [
                    ['balance', ledger.totals.balance],
                    ['lateFeeOutstanding', ledger.totals.lateFeeOutstanding],
                    ['payable', ledger.totals.payable],
                  ] as const
                ).map(([key, v]) => (
                  <Card key={key} elevated>
                    <div className="ep-kicker">{k(key)}</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: 'var(--fs-h3)',
                        fontWeight: 600,
                      }}
                    >
                      ₹{v}
                    </div>
                  </Card>
                ))}
              </div>
              <DataTable<FeeLedgerInstalment>
                caption={k('instalment')}
                density="dense"
                columns={[
                  {
                    key: 'label',
                    header: k('instalment'),
                    render: (x) => <strong>{x.label}</strong>,
                  },
                  { key: 'due', header: k('dueOn'), render: (x) => x.dueOn },
                  { key: 'bal', header: k('balance'), numeric: true, render: (x) => x.balance },
                  {
                    key: 'late',
                    header: k('lateFee'),
                    numeric: true,
                    render: (x) =>
                      Number(x.lateFee.outstanding) > 0 ? x.lateFee.outstanding : '—',
                  },
                  {
                    key: 'status',
                    header: k('status'),
                    render: (x) => (
                      <Badge tone={toneFor(x.status)}>{f(`statuses.${x.status}`)}</Badge>
                    ),
                  },
                ]}
                rows={ledger.instalments}
                rowKey={(x) => x.dueOn}
                emptyTitle={f('noInstalments')}
              />
              <p style={{ marginTop: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/fees/ledger/${ledger.student.id}`}
                >
                  {k('openLedger')}
                </a>
              </p>
            </>
          ) : null}
        </Card>

        {ledger && yearOpen ? (
          <Card title={k('post')}>
            <p className="ep-field__help">{k('help')}</p>
            <form action={postCashierReceipt}>
              <input type="hidden" name="studentId" value={ledger.student.id} />
              <FormRow columns={3}>
                <InputField
                  id="amount"
                  name="amount"
                  label={k('amount')}
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  defaultValue={Number(ledger.totals.payable) > 0 ? ledger.totals.payable : ''}
                />
                <SelectField
                  id="mode"
                  name="mode"
                  label={k('mode')}
                  help={modeHelp || undefined}
                  options={
                    counterModes.length > 0
                      ? counterModes.map((m) => ({
                          // a mode the school added travels as kind|code
                          value: m.code === m.kind ? m.code : `${m.kind}|${m.code}`,
                          label: m.label,
                        }))
                      : (['cash', 'upi', 'card', 'bank', 'cheque', 'dd'] as const).map((m) => ({
                          value: m,
                          label: k(`modes.${m}`),
                        }))
                  }
                />
                <InputField
                  id="receivedOn"
                  name="receivedOn"
                  label={k('receivedOn')}
                  type="date"
                  defaultValue={today}
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField
                  id="instrumentNo"
                  name="instrumentNo"
                  label={k('instrumentNo')}
                  maxLength={40}
                />
                <InputField
                  id="instrumentDate"
                  name="instrumentDate"
                  label={k('instrumentDate')}
                  type="date"
                />
                <InputField id="bankName" name="bankName" label={k('bankName')} maxLength={80} />
              </FormRow>
              <FormRow columns={3}>
                <InputField id="reference" name="reference" label={k('reference')} maxLength={80} />
                <SelectField
                  id="ledger"
                  name="ledger"
                  label={k('ledger')}
                  options={(['school', 'hostel', 'misc'] as const).map((l) => ({
                    value: l,
                    label: k(`ledgers.${l}`),
                  }))}
                />
                {canWaive ? (
                  <SelectField
                    id="collectLateFee"
                    name="collectLateFee"
                    label={k('lateFee')}
                    options={[
                      { value: 'yes', label: k('collectLateFee') },
                      { value: 'no', label: k('leaveLateFee') },
                    ]}
                  />
                ) : (
                  <input type="hidden" name="collectLateFee" value="yes" />
                )}
              </FormRow>
              <FormRow columns={1}>
                <InputField id="remarks" name="remarks" label={k('remarks')} maxLength={300} />
              </FormRow>
              <FormActions>
                <Button type="submit">{k('post')}</Button>
              </FormActions>
            </form>
            <h4 style={{ fontFamily: 'var(--font-heading)', margin: 'var(--sp-4) 0 var(--sp-2)' }}>
              {k('lastReceipts')}
            </h4>
            <DataTable<FeeLedgerPayment>
              caption={k('lastReceipts')}
              density="dense"
              columns={[
                {
                  key: 'no',
                  header: k('receiptNo'),
                  render: (p) => <strong>{p.receiptNo ?? '—'}</strong>,
                },
                { key: 'on', header: k('receivedOn'), render: (p) => p.receivedOn },
                { key: 'amount', header: k('amount'), numeric: true, render: (p) => p.amount },
                { key: 'late', header: k('lateFee'), numeric: true, render: (p) => p.lateFee },
                { key: 'mode', header: k('mode'), render: (p) => p.mode.toUpperCase() },
                {
                  key: 'pdf',
                  header: '',
                  render: (p) => (
                    <form action={queueCashierReceiptPdf}>
                      <input type="hidden" name="studentId" value={ledger.student.id} />
                      <input type="hidden" name="paymentId" value={p.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {k('printReceipt')}
                      </Button>
                    </form>
                  ),
                },
              ]}
              rows={ledger.payments.slice(0, 5)}
              rowKey={(p) => p.id}
              emptyTitle={f('noPayments')}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
