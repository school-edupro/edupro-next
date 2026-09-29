import {
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
import { recordOfflinePayment } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Page, PaymentIntent, Student } from '@/lib/types';

const tone = (s: PaymentIntent['status']) =>
  s === 'succeeded'
    ? 'success'
    : s === 'failed' || s === 'cancelled'
      ? 'danger'
      : s === 'pending'
        ? 'warning'
        : 'neutral';

/** S9-03: online payment intents and counter receipts (allocated to the oldest dues). */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    purpose?: string;
    classSectionId?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '50' });
  if (sp.status) q.set('status', sp.status);
  if (sp.purpose) q.set('purpose', sp.purpose);
  const [t, p, me, intents, sections, students] = await Promise.all([
    getTranslations('pages.fees_payments'),
    getTranslations('payments'),
    getMe(),
    apiFetch<Page<PaymentIntent>>(`/payments/intents?${q.toString()}`),
    sectionOptions(),
    sp.classSectionId
      ? apiFetch<Page<Student>>(
          `/people/students?classSectionId=${sp.classSectionId}&size=200`,
        ).then((r) => r.data)
      : Promise.resolve<Student[]>([]),
  ]);
  const canRecord = me.permissions.includes('payments.offline.record');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={p('intents')}>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
              flexWrap: 'wrap',
            }}
          >
            <SelectField
              id="status"
              name="status"
              label={p('status')}
              defaultValue={sp.status ?? ''}
              options={[
                { value: '', label: '—' },
                ...(['created', 'pending', 'succeeded', 'failed', 'cancelled'] as const).map(
                  (s) => ({ value: s, label: p(`statuses.${s}`) }),
                ),
              ]}
            />
            <SelectField
              id="purpose"
              name="purpose"
              label={p('purpose')}
              defaultValue={sp.purpose ?? ''}
              options={[
                { value: '', label: '—' },
                ...(['admission_fee', 'fee_instalment', 'misc'] as const).map((s) => ({
                  value: s,
                  label: p(`purposes.${s}`),
                })),
              ]}
            />
            <Button type="submit" variant="secondary">
              {p('filter')}
            </Button>
          </form>
          <DataTable<PaymentIntent>
            caption={`${p('intents')} · ${intents.page.total}`}
            density="dense"
            columns={[
              {
                key: 'when',
                header: p('createdAt'),
                render: (i) => new Date(i.createdAt).toLocaleString('en-IN'),
              },
              { key: 'txn', header: p('txnId'), render: (i) => <code>{i.txnId}</code> },
              { key: 'purpose', header: p('purpose'), render: (i) => p(`purposes.${i.purpose}`) },
              {
                key: 'payer',
                header: p('payer'),
                render: (i) => `${i.payerName ?? ''} ${i.payerMobile ?? ''}`.trim(),
              },
              { key: 'amount', header: p('amount'), numeric: true, render: (i) => `₹${i.amount}` },
              {
                key: 'status',
                header: p('status'),
                render: (i) => (
                  <span title={i.failedReason ?? ''}>
                    <Badge tone={tone(i.status)}>{p(`statuses.${i.status}`)}</Badge>
                  </span>
                ),
              },
              { key: 'provider', header: p('provider'), render: (i) => i.provider },
            ]}
            rows={intents.data}
            rowKey={(i) => i.id}
            emptyTitle={p('noIntents')}
          />
        </Card>
        {canRecord ? (
          <Card title={p('recordOffline')}>
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
                id="classSectionId"
                name="classSectionId"
                label={p('student')}
                defaultValue={sp.classSectionId ?? ''}
                options={[{ value: '', label: '—' }, ...sections]}
              />
              <Button type="submit" variant="secondary">
                {p('findStudent')}
              </Button>
            </form>
            {students.length ? (
              <form action={recordOfflinePayment}>
                <FormRow columns={2}>
                  <SelectField
                    id="studentId"
                    name="studentId"
                    label={p('student')}
                    options={students.map((s) => ({
                      value: s.id,
                      label: `${s.displayName} · ${s.admissionNo}`,
                    }))}
                  />
                  <InputField
                    id="amount"
                    name="amount"
                    label={p('amount')}
                    type="number"
                    min={1}
                    step="0.01"
                    required
                  />
                </FormRow>
                <FormRow columns={3}>
                  <SelectField
                    id="mode"
                    name="mode"
                    label={p('mode')}
                    options={(['cash', 'cheque', 'upi', 'bank'] as const).map((m) => ({
                      value: m,
                      label: p(`modes.${m}`),
                    }))}
                  />
                  <InputField
                    id="reference"
                    name="reference"
                    label={p('reference')}
                    maxLength={80}
                  />
                  <InputField
                    id="receivedOn"
                    name="receivedOn"
                    label={p('receivedOn')}
                    type="date"
                  />
                </FormRow>
                <FormRow columns={1}>
                  <InputField id="remarks" name="remarks" label={p('remarks')} maxLength={300} />
                </FormRow>
                <FormActions>
                  <Button type="submit">{p('record')}</Button>
                </FormActions>
              </form>
            ) : sp.classSectionId ? (
              <p className="ep-field__help">{p('noStudent')}</p>
            ) : null}
            <p className="ep-field__help">{p('recorded')}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
