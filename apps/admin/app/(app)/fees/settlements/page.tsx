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
import { uploadSettlement } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { PaymentSettlement } from '@/lib/types';

/** Sprint 13: gateway settlement files and their matching. */
export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, s, me, settlements] = await Promise.all([
    getTranslations('pages.fees_settlements'),
    getTranslations('settlements'),
    getMe(),
    apiFetch<{ data: PaymentSettlement[] }>('/payments/settlements').then((r) => r.data),
  ]);
  const canUpload = me.permissions.includes('payments.settlement.manage');
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
        <Card title={s('settlements')}>
          <DataTable<PaymentSettlement>
            caption={s('settlements')}
            density="dense"
            columns={[
              { key: 'on', header: s('settledOn'), render: (x) => x.settledOn },
              { key: 'provider', header: s('provider'), render: (x) => x.provider },
              {
                key: 'ref',
                header: s('settlementRef'),
                render: (x) => <strong>{x.settlementRef}</strong>,
              },
              { key: 'utr', header: s('utr'), render: (x) => x.utr ?? '—' },
              { key: 'gross', header: s('gross'), numeric: true, render: (x) => x.gross },
              { key: 'net', header: s('net'), numeric: true, render: (x) => x.net },
              { key: 'rows', header: s('rows'), numeric: true, render: (x) => x.rows },
              { key: 'matched', header: s('matched'), numeric: true, render: (x) => x.matched },
              {
                key: 'unmatched',
                header: s('unmatched'),
                numeric: true,
                render: (x) => x.unmatched,
              },
              {
                key: 'mismatched',
                header: s('mismatched'),
                numeric: true,
                render: (x) => x.mismatched,
              },
              {
                key: 'open',
                header: '',
                render: (x) => (
                  <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/fees/settlements/${x.id}`}>
                    {s('open')}
                  </a>
                ),
              },
            ]}
            rows={settlements}
            rowKey={(x) => x.id}
            emptyTitle={s('noSettlements')}
          />
        </Card>
        {canUpload ? (
          <Card title={s('upload')}>
            <p className="ep-field__help">{s('csvHelp')}</p>
            <form action={uploadSettlement}>
              <FormRow columns={2}>
                <SelectField
                  id="provider"
                  name="provider"
                  label={s('provider')}
                  options={['razorpay', 'payu', 'ccavenue', 'mock'].map((p) => ({
                    value: p,
                    label: p,
                  }))}
                />
                <InputField
                  id="settlementRef"
                  name="settlementRef"
                  label={s('settlementRef')}
                  required
                  maxLength={80}
                />
              </FormRow>
              <FormRow columns={2}>
                <InputField
                  id="settledOn"
                  name="settledOn"
                  label={s('settledOn')}
                  type="date"
                  required
                />
                <InputField id="utr" name="utr" label={s('utr')} maxLength={60} />
              </FormRow>
              <FormRow columns={1}>
                <InputField
                  id="file"
                  name="file"
                  label={s('csv')}
                  type="file"
                  accept=".csv,text/csv"
                />
              </FormRow>
              <FormRow columns={1}>
                <label className="ep-field">
                  <span className="ep-field__label">CSV</span>
                  <textarea
                    className="ep-input"
                    name="csv"
                    rows={4}
                    placeholder="payment_id,order_id,amount,fee,tax"
                  />
                </label>
              </FormRow>
              <FormActions>
                <Button type="submit">{s('upload')}</Button>
              </FormActions>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
