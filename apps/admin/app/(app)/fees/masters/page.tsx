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
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { setReceiptSequence } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ReceiptSequence } from '@/lib/types';

/** Receipt numbering per fee type and financial year. The fee calendar is kept class by class. */
export default async function FeeMastersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, f, me] = await Promise.all([
    getTranslations('pages.fees_masters'),
    getTranslations('fees'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('fees.master.manage');
  const sequences = await apiFetch<{ data: ReceiptSequence[] }>('/fees/receipt-sequences').then(
    (r) => r.data,
  );
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Receipt numbers"
        description="Prefix, width and starting number of receipts for each fee type and financial year. Set them before the first receipt of the year."
      />
      <FeeSetupNav current="/fees/masters" />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={f('receiptSequences')}>
          <p className="ep-field__help">{f('sequenceHelp')}</p>
          <DataTable<ReceiptSequence>
            caption={f('receiptSequences')}
            density="dense"
            columns={[
              { key: 'fy', header: f('financialYear'), render: (s) => s.financialYear },
              { key: 'ledger', header: f('ledgerType'), render: (s) => s.ledger },
              {
                key: 'prefix',
                header: f('prefix'),
                render: (s) => (
                  <span>
                    <strong>{s.prefix}</strong>
                    {s.configured ? '' : ` (${f('notConfigured')})`}
                  </span>
                ),
              },
              { key: 'width', header: f('width'), numeric: true, render: (s) => s.width },
              { key: 'next', header: f('nextNo'), numeric: true, render: (s) => s.nextNo },
              { key: 'issued', header: f('issued'), numeric: true, render: (s) => s.issued },
            ]}
            rows={sequences}
            rowKey={(s) => `${s.financialYearId}-${s.ledger}`}
            emptyTitle={f('receiptSequences')}
          />
          {canManage && sequences.length ? (
            <form action={setReceiptSequence} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={4}>
                <SelectField
                  id="rsFy"
                  name="financialYearId"
                  label={f('financialYear')}
                  options={[
                    ...new Map(sequences.map((s) => [s.financialYearId, s.financialYear])),
                  ].map(([value, label]) => ({ value, label }))}
                />
                <SelectField
                  id="rsLedger"
                  name="ledger"
                  label={f('ledgerType')}
                  options={['school', 'hostel', 'misc', 'admission'].map((l) => ({
                    value: l,
                    label: l,
                  }))}
                />
                <InputField
                  id="rsPrefix"
                  name="prefix"
                  label={f('prefix')}
                  required
                  maxLength={24}
                />
                <InputField
                  id="rsWidth"
                  name="width"
                  label={f('width')}
                  type="number"
                  min={1}
                  max={12}
                  defaultValue={6}
                />
                <InputField
                  id="rsStart"
                  name="startAt"
                  label={f('startAt')}
                  type="number"
                  min={1}
                  defaultValue={1}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('saveSequence')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
