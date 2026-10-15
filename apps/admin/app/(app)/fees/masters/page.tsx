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
import { saveFeeLayouts } from '@/lib/fee-setup-actions';
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
  // the school's bill and receipt layout (same for school, hostel and misc fee) and the copies printed
  const settings = await apiFetch<{ data: Array<{ key: string; value: unknown }> }>(
    '/platform/settings',
  )
    .then((r) => r.data)
    .catch(() => [] as Array<{ key: string; value: unknown }>);
  const val = (k: string, d: string) => String(settings.find((x) => x.key === k)?.value ?? d);
  const billLayout = val('fees.bill_layout', 'annual');
  const receiptLayout = val('fees.receipt_layout', 'two_panel');
  const copies = val('fees.receipt_copies', 'parent_school');
  const canLayout = canManage && me.permissions.includes('platform.settings.edit');
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Receipt numbers, layouts"
        description="Prefix, width and starting number of receipts for each fee type and financial year (set them before the first receipt of the year), and how the fee bill and receipt look."
      />
      <FeeSetupNav current="/fees/masters" />
      <Notice params={sp} />
      <Card title="Bill and receipt layout" style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={saveFeeLayouts} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {(
            [
              [
                'billLayout',
                'Fee bill',
                billLayout,
                [
                  [
                    'annual',
                    'School annual bill',
                    'Letterhead, heads of the session, instalment schedule with paid and balance, fee received, balance in words.',
                  ],
                  [
                    'instalment',
                    'Instalment bill',
                    'The earlier bill: what is payable instalment by instalment, head by head, with the late fee.',
                  ],
                ],
              ],
              [
                'receiptLayout',
                'Fee receipt',
                receiptLayout,
                [
                  [
                    'two_panel',
                    'Two-panel receipt',
                    'School and pupil on the left, instalment, heads paid and amount in words on the right (A4 landscape).',
                  ],
                  [
                    'classic',
                    'Classic receipt',
                    'The earlier receipt: one column, particulars by period (A4 portrait).',
                  ],
                ],
              ],
            ] as const
          ).map(([name, label, current, options]) => (
            <fieldset key={name} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">{label}</legend>
              {options.map(([v, title, help]) => (
                <label key={v} style={{ display: 'block', marginTop: 'var(--sp-2)' }}>
                  <input
                    type="radio"
                    name={name}
                    value={v}
                    defaultChecked={current === v}
                    disabled={!canLayout}
                  />{' '}
                  <strong>{title}</strong>{' '}
                  <a
                    href={`/fees/layout-preview?kind=${name === 'billLayout' ? 'bill' : 'receipt'}&layout=${v}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'underline' }}
                  >
                    Preview
                  </a>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {help}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <label className="ep-field" htmlFor="rcCopies" style={{ maxWidth: '24rem' }}>
            <span className="ep-field__label">Receipt copies printed</span>
            <select
              className="ep-select"
              id="rcCopies"
              name="copies"
              defaultValue={copies}
              disabled={!canLayout}
            >
              <option value="parent">Parent copy only</option>
              <option value="parent_school">Parent copy and school copy</option>
              <option value="parent_school_office">Parent, school and office copy</option>
            </select>
            <span className="ep-field__help">The parent app always gives the parent copy.</span>
          </label>
          <p className="ep-field__help">
            The same layout is used for school, hostel and misc fee, on screen, in print and in the
            PDF.
          </p>
          {canLayout ? (
            <div>
              <Button type="submit">Save layout</Button>
            </div>
          ) : null}
        </form>
      </Card>
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
