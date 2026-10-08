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
import { generateFeePeriods, setPeriodLateFee, setReceiptSequence } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { FeePeriod, ReceiptSequence } from '@/lib/types';

/** The fee calendar of the working year, the late fee of each instalment and receipt numbering. */
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
  const [periods, sequences] = await Promise.all([
    apiFetch<{ data: FeePeriod[] }>('/fees/periods').then((r) => r.data),
    apiFetch<{ data: ReceiptSequence[] }>('/fees/receipt-sequences').then((r) => r.data),
  ]);
  const anchors = periods.filter((p, i) => i === 0 || periods[i - 1]!.instalment !== p.instalment);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Fee calendar, late fee and receipt numbers"
        description="The twelve months of the year with their instalments and last dates, the late fee of each instalment, and receipt numbering. Heads, discounts, slabs and banks are on the first tab."
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
        <Card title={f('periods')}>
          <DataTable<FeePeriod>
            caption={f('periods')}
            density="dense"
            columns={[
              { key: 'seq', header: '#', numeric: true, render: (p) => p.sequence },
              { key: 'name', header: f('period'), render: (p) => p.name },
              { key: 'inst', header: f('instalment'), numeric: true, render: (p) => p.instalment },
              { key: 'due', header: f('dueOn'), render: (p) => p.dueOn },
            ]}
            rows={periods}
            rowKey={(p) => p.id}
            emptyTitle={f('noPeriods')}
          />
          {canManage ? (
            <form action={generateFeePeriods} style={{ marginTop: 'var(--sp-4)' }}>
              <FormRow columns={3}>
                <InputField
                  id="dueDay"
                  name="dueDay"
                  label={f('dueDay')}
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={10}
                />
                <SelectField
                  id="mpi"
                  name="monthsPerInstalment"
                  label={f('monthsPerInstalment')}
                  defaultValue="3"
                  options={[
                    { value: '1', label: '1' },
                    { value: '3', label: '3' },
                    { value: '6', label: '6' },
                    { value: '12', label: '12' },
                  ]}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {f('generatePeriods')}
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
        {canManage && anchors.length ? (
          <Card title={f('lateFeeSetup')}>
            <p className="ep-field__help">{f('lateFeeSetupHelp')}</p>
            {anchors.map((p) => (
              <form
                key={p.id}
                action={setPeriodLateFee}
                style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--sp-3)' }}
              >
                <input type="hidden" name="periodId" value={p.id} />
                <strong>
                  {f('instalment')} {p.instalment} · {p.name} · {f('dueOn')} {p.dueOn}
                </strong>
                <FormRow columns={4}>
                  <InputField
                    id={`lf-${p.id}`}
                    name="lateFeeAmount"
                    label={f('lateFeeAfterDue')}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={Number(p.lateFeeAmount ?? 0)}
                  />
                  <InputField
                    id={`vf-${p.id}`}
                    name="visibleFrom"
                    label={f('visibleFrom')}
                    type="date"
                    defaultValue={p.visibleFrom ?? ''}
                  />
                  {[1, 2, 3].map((n) => (
                    <span key={n} style={{ display: 'contents' }}>
                      <InputField
                        id={`s${n}on-${p.id}`}
                        name={`slab${n}On`}
                        label={`${f('slabOn')} ${n}`}
                        type="date"
                        defaultValue={p.slabs?.[n - 1]?.on ?? ''}
                      />
                      <InputField
                        id={`s${n}amt-${p.id}`}
                        name={`slab${n}Amount`}
                        label={`${f('slabAmount')} ${n}`}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={p.slabs?.[n - 1] ? Number(p.slabs[n - 1]!.amount) : ''}
                      />
                    </span>
                  ))}
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="ghost" size="sm">
                    {f('saveLateFee')}
                  </Button>
                </FormActions>
              </form>
            ))}
          </Card>
        ) : null}
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
