import {
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
import { postMiscReceipt, reconcileNow } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { FeeHead, MiscReceipt, Page, ReconciliationRun, Student } from '@/lib/types';

/** Sprint 14: misc receipts (students, employees, vendors, others) and the daily reconciliation. */
export default async function MiscReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    payerKind?: string;
    classSectionId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '100' });
  if (sp.payerKind) q.set('payerKind', sp.payerKind);
  if (sp.from) q.set('from', sp.from);
  if (sp.to) q.set('to', sp.to);
  const [t, m, me, receipts, heads, sections, runs] = await Promise.all([
    getTranslations('pages.fees_misc'),
    getTranslations('misc'),
    getMe(),
    apiFetch<Page<MiscReceipt>>(`/fees/misc/receipts?${q.toString()}`),
    apiFetch<{ data: FeeHead[] }>('/fees/heads').then((r) =>
      r.data.filter((h) => h.ledger === 'misc' && h.status === 'active'),
    ),
    sectionOptions(),
    apiFetch<{ data: ReconciliationRun[] }>('/fees/reconciliations')
      .then((r) => r.data)
      .catch(() => [] as ReconciliationRun[]),
  ]);
  const canPost = me.permissions.includes('fees.misc.post');
  const canReconcile = me.permissions.includes('payments.reconcile.run');
  const students = sp.classSectionId
    ? await apiFetch<Page<Student>>(
        `/people/students?classSectionId=${sp.classSectionId}&size=200`,
      ).then((r) => r.data)
    : [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={t('title')}>
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
              id="payerKind"
              name="payerKind"
              label={m('payerKind')}
              defaultValue={sp.payerKind ?? ''}
              options={[
                { value: '', label: '—' },
                ...(['student', 'employee', 'vendor', 'other'] as const).map((k) => ({
                  value: k,
                  label: m(`payerKinds.${k}`),
                })),
              ]}
            />
            <InputField
              id="from"
              name="from"
              label={m('from')}
              type="date"
              defaultValue={sp.from ?? ''}
            />
            <InputField id="to" name="to" label={m('to')} type="date" defaultValue={sp.to ?? ''} />
            <Button type="submit" variant="secondary">
              {m('filter')}
            </Button>
          </form>
          <DataTable<MiscReceipt>
            caption={`${t('title')} · ${receipts.page.total}`}
            density="dense"
            columns={[
              { key: 'no', header: m('receiptNo'), render: (r) => <strong>{r.receiptNo}</strong> },
              { key: 'on', header: m('receivedOn'), render: (r) => r.receivedOn },
              {
                key: 'payer',
                header: m('payerName'),
                render: (r) => `${r.payerName} (${m(`payerKinds.${r.payerKind}`)})`,
              },
              { key: 'head', header: m('head'), render: (r) => r.headName },
              { key: 'amount', header: m('amount'), numeric: true, render: (r) => `₹${r.amount}` },
              {
                key: 'mode',
                header: m('mode'),
                render: (r) =>
                  `${r.mode.toUpperCase()}${r.reference ? ` · ${r.reference}` : ''}${r.instrumentNo ? ` · ${r.instrumentNo}` : ''}`,
              },
              { key: 'by', header: m('receivedBy'), render: (r) => r.receivedBy ?? '' },
            ]}
            rows={receipts.data}
            rowKey={(r) => r.id}
            emptyTitle={m('noReceipts')}
          />
        </Card>
        {canPost ? (
          <Card title={m('post')}>
            <p className="ep-field__help">{m('help')}</p>
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
                label={m('section')}
                defaultValue={sp.classSectionId ?? ''}
                options={[{ value: '', label: '—' }, ...sections]}
              />
              <Button type="submit" variant="secondary">
                {m('student')}
              </Button>
            </form>
            <form action={postMiscReceipt}>
              <FormRow columns={3}>
                <SelectField
                  id="payerKindIn"
                  name="payerKind"
                  label={m('payerKind')}
                  defaultValue={students.length ? 'student' : 'vendor'}
                  options={(['student', 'employee', 'vendor', 'other'] as const).map((k) => ({
                    value: k,
                    label: m(`payerKinds.${k}`),
                  }))}
                />
                <SelectField
                  id="studentId"
                  name="studentId"
                  label={m('student')}
                  options={[
                    { value: '', label: '—' },
                    ...students.map((s) => ({
                      value: s.id,
                      label: `${s.displayName} · ${s.admissionNo}`,
                    })),
                  ]}
                />
                <InputField
                  id="employeeId"
                  name="employeeId"
                  label={`${m('employee')} (id)`}
                  pattern="[0-9]*"
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField
                  id="payerName"
                  name="payerName"
                  label={m('payerName')}
                  maxLength={120}
                />
                <InputField
                  id="payerMobile"
                  name="payerMobile"
                  label={m('payerMobile')}
                  pattern="[6-9][0-9]{9}"
                />
                <SelectField
                  id="headId"
                  name="headId"
                  label={m('head')}
                  options={heads.map((h) => ({ value: h.id, label: `${h.code} · ${h.name}` }))}
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField
                  id="amount"
                  name="amount"
                  label={m('amount')}
                  type="number"
                  min={1}
                  step="0.01"
                  required
                />
                <SelectField
                  id="mode"
                  name="mode"
                  label={m('mode')}
                  options={['cash', 'upi', 'card', 'bank', 'cheque', 'dd'].map((x) => ({
                    value: x,
                    label: x.toUpperCase(),
                  }))}
                />
                <InputField
                  id="receivedOn"
                  name="receivedOn"
                  label={m('receivedOn')}
                  type="date"
                  defaultValue={today}
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField id="reference" name="reference" label={m('reference')} maxLength={80} />
                <InputField
                  id="instrumentNo"
                  name="instrumentNo"
                  label={m('instrumentNo')}
                  maxLength={40}
                />
                <InputField id="bankName" name="bankName" label={m('bankName')} maxLength={80} />
              </FormRow>
              <FormRow columns={1}>
                <InputField id="remarks" name="remarks" label={m('remarks')} maxLength={300} />
              </FormRow>
              <FormActions>
                <Button type="submit">{m('post')}</Button>
              </FormActions>
            </form>
          </Card>
        ) : null}
      </div>
      <Card title={m('reconciliation')} style={{ marginTop: 'var(--sp-4)' }}>
        {canReconcile ? (
          <form action={reconcileNow} style={{ marginBottom: 'var(--sp-3)' }}>
            <Button type="submit" variant="secondary">
              {m('runNow')}
            </Button>
          </form>
        ) : null}
        <DataTable<ReconciliationRun>
          caption={m('reconciliation')}
          density="dense"
          columns={[
            { key: 'date', header: m('runDate'), render: (r) => <strong>{r.runDate}</strong> },
            {
              key: 'online',
              header: m('onlineReceipts'),
              numeric: true,
              render: (r) => `${r.onlineReceipts} · ₹${r.onlineAmount}`,
            },
            {
              key: 'settled',
              header: m('settled'),
              numeric: true,
              render: (r) => `${r.settledReceipts} · ₹${r.settledAmount}`,
            },
            {
              key: 'unsettled',
              header: m('unsettled'),
              numeric: true,
              render: (r) => `${r.unsettledReceipts} · ₹${r.unsettledAmount}`,
            },
            {
              key: 'aged',
              header: m('agedUnsettled'),
              numeric: true,
              render: (r) => r.agedUnsettled,
            },
            {
              key: 'unmatched',
              header: m('unmatchedLines'),
              numeric: true,
              render: (r) => r.unmatchedLines,
            },
            {
              key: 'mismatched',
              header: m('mismatchedLines'),
              numeric: true,
              render: (r) => r.mismatchedLines,
            },
            {
              key: 'wo',
              header: m('withoutReceipt'),
              numeric: true,
              render: (r) => r.succeededWithoutReceipt,
            },
            { key: 'var', header: m('variance'), numeric: true, render: (r) => `₹${r.variance}` },
          ]}
          rows={runs}
          rowKey={(r) => r.id}
          emptyTitle={m('noRuns')}
        />
      </Card>
    </>
  );
}
