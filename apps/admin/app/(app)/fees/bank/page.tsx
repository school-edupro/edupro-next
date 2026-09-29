import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { uploadBankStatement } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { BankStatement } from '@/lib/types';

const money = (v: unknown) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  matched: 'success',
  unmatched: 'warning',
  ambiguous: 'warning',
  returned: 'danger',
  ignored: 'neutral',
};

/** Sprint 15: bank upload reconciliation. */
export default async function BankStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, b, me, statements, chosen] = await Promise.all([
    getTranslations('pages.fees_bank'),
    getTranslations('bank'),
    getMe(),
    apiFetch<{ data: BankStatement[] }>('/payments/bank-statements').then((x) => x.data),
    sp.id ? apiFetch<BankStatement>(`/payments/bank-statements/${sp.id}`) : Promise.resolve(null),
  ]);
  const canUpload = me.permissions.includes('payments.settlement.manage');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {b('matchedOk')}
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={b('statements')}>
          <DataTable<BankStatement>
            caption={`${b('statements')} · ${statements.length}`}
            density="dense"
            columns={[
              {
                key: 'bank',
                header: b('bankName'),
                render: (s) => (
                  <a href={`/fees/bank?id=${s.id}`}>
                    <strong>{s.bankName}</strong>
                    {s.accountRef ? ` · ${s.accountRef}` : ''}
                  </a>
                ),
              },
              {
                key: 'period',
                header: b('period'),
                render: (s) => `${s.fromDate ?? ''} → ${s.toDate ?? ''}`,
              },
              { key: 'rows', header: b('rows'), numeric: true, render: (s) => s.rows },
              { key: 'matched', header: b('matched'), numeric: true, render: (s) => s.matched },
              {
                key: 'unmatched',
                header: b('unmatched'),
                numeric: true,
                render: (s) => s.unmatched,
              },
              {
                key: 'returned',
                header: b('returned'),
                numeric: true,
                render: (s) => (s.returned ? <Badge tone="danger">{s.returned}</Badge> : 0),
              },
              {
                key: 'credits',
                header: b('credits'),
                numeric: true,
                render: (s) => money(s.credits),
              },
              {
                key: 'by',
                header: b('by'),
                render: (s) => `${s.uploadedBy ?? ''} · ${s.createdAt.slice(0, 10)}`,
              },
            ]}
            rows={statements}
            rowKey={(s) => s.id}
            emptyTitle="—"
          />
        </Card>
        {canUpload ? (
          <Card title={b('upload')}>
            <form action={uploadBankStatement} encType="multipart/form-data">
              <FormRow columns={2}>
                <InputField
                  id="bankName"
                  name="bankName"
                  label={b('bankName')}
                  required
                  maxLength={80}
                />
                <InputField
                  id="accountRef"
                  name="accountRef"
                  label={b('accountRef')}
                  maxLength={40}
                />
              </FormRow>
              <label className="ep-field">
                <span className="ep-field__label">{b('file')}</span>
                <input
                  className="ep-input"
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                />
                <span className="ep-field__help">{b('fileHelp')}</span>
              </label>
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
              >
                <Button type="submit">{b('uploadBtn')}</Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
      {chosen?.lines ? (
        <Card
          title={b('lines', {
            name: `${chosen.bankName} ${chosen.fromDate ?? ''} → ${chosen.toDate ?? ''}`,
          })}
          style={{ marginTop: 'var(--sp-5)' }}
        >
          {chosen.returned ? <p className="ep-field__help">{b('returnedHelp')}</p> : null}
          <DataTable<NonNullable<BankStatement['lines']>[number]>
            caption={`${b('rows')} · ${chosen.lines.length}`}
            density="dense"
            columns={[
              { key: 'n', header: b('line'), render: (l) => l.lineNo },
              {
                key: 'd',
                header: b('date'),
                render: (l) =>
                  `${l.txnDate}${l.valueDate && l.valueDate !== l.txnDate ? ` (${l.valueDate})` : ''}`,
              },
              { key: 'na', header: b('narration'), render: (l) => l.narration ?? '' },
              { key: 'r', header: b('reference'), render: (l) => l.reference ?? '' },
              {
                key: 'dr',
                header: b('debit'),
                numeric: true,
                render: (l) => (Number(l.debit) ? money(l.debit) : ''),
              },
              {
                key: 'cr',
                header: b('credit'),
                numeric: true,
                render: (l) => (Number(l.credit) ? money(l.credit) : ''),
              },
              {
                key: 's',
                header: b('status'),
                render: (l) => <Badge tone={TONE[l.status] ?? 'neutral'}>{l.status}</Badge>,
              },
              { key: 'rc', header: b('receipt'), render: (l) => l.receiptNo ?? '' },
              {
                key: 'no',
                header: b('note'),
                render: (l) => `${l.matchedBy ? `${l.matchedBy} · ` : ''}${l.note ?? ''}`,
              },
            ]}
            rows={chosen.lines}
            rowKey={(l) => l.id}
            emptyTitle="—"
          />
        </Card>
      ) : null}
    </>
  );
}
