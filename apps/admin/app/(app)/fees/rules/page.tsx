import {
  Button,
  Card,
  Checkbox,
  FormActions,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { apiFetch, getMe } from '@/lib/api';
import { saveClassRules, savePaymentMode } from '@/lib/fee-setup-actions';
import type { ClassRow, Page } from '@/lib/types';

interface RulePeriod {
  periodId: string;
  sequence: number;
  name: string;
  schoolDueOn: string;
  schoolLateFee: string;
  dueOn: string | null;
  lateFeeAmount: string | null;
  slabs: Array<{ on: string; amount: string }>;
  latePerDay: string | null;
}
interface ClassRules {
  classId: string;
  bounceCharge: string | null;
  schoolBounceCharge: string;
  lateFeeMode: 'slab' | 'daywise';
  periods: RulePeriod[];
}
interface PaymentMode {
  code: string;
  label: string;
  atCounter: boolean;
  needReference: boolean;
  needInstrumentNo: boolean;
  needInstrumentDate: boolean;
  needBank: boolean;
}

const date = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

/**
 * Fee set-up, second pass: how a head prints and whether it counts for the tax certificate, a class's
 * own last dates, late fee and bounce charge, and the payment mode master.
 */
export default async function FeeRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classId?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('fees.master.manage');
  const [modes, classes, rules] = await Promise.all([
    apiFetch<{ data: PaymentMode[] }>('/fees/payment-modes').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sp.classId
      ? apiFetch<{ data: ClassRules }>(`/fees/class-rules/${sp.classId}`).then((r) => r.data)
      : Promise.resolve<ClassRules | null>(null),
  ]);
  const cls = classes.find((k) => k.id === sp.classId);
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Class rules and payment modes"
        description="A class can have its own last date, late fee and cheque-bounce charge. Payment modes decide what the counter accepts and which fields are mandatory."
      />
      <FeeSetupNav current="/fees/rules" />
      <Notice params={sp} />
      <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
        <Card title="Class rules">
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="classId"
              name="classId"
              label="Class"
              defaultValue={sp.classId ?? ''}
              options={[
                { value: '', label: '—' },
                ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
              ]}
            />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          {cls && rules ? (
            <form action={saveClassRules} style={{ marginTop: 'var(--sp-4)' }}>
              <input type="hidden" name="classId" value={cls.id} />
              <p className="ep-field__help">
                Leave a box empty to follow the school. Late fee works{' '}
                <strong>{rules.lateFeeMode === 'slab' ? 'by slab' : 'per day'}</strong> in this
                school
                {rules.lateFeeMode === 'slab'
                  ? ': the amount applies after the last date, and each later date raises it.'
                  : ': give the rupees per day for this class.'}{' '}
                Unpaid bills of the class move to a new last date as soon as you save.
              </p>
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{cls.name}: own last dates and late fee</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">School last date</th>
                      <th scope="col">Class last date</th>
                      {rules.lateFeeMode === 'slab' ? (
                        <>
                          <th scope="col">Late fee (school)</th>
                          <th scope="col">Late fee (class)</th>
                          <th scope="col">From date → amount</th>
                        </>
                      ) : (
                        <th scope="col">Late fee per day (class)</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.periods.map((p) => (
                      <tr key={p.periodId}>
                        <th scope="row">
                          <input type="hidden" name="periodIds" value={p.periodId} />
                          {p.name}
                        </th>
                        <td>{date(p.schoolDueOn)}</td>
                        <td>
                          <input
                            className="ep-input"
                            type="date"
                            name={`dueOn:${p.periodId}`}
                            defaultValue={p.dueOn ?? ''}
                            disabled={!canManage}
                            aria-label={`${p.name}: class last date`}
                          />
                        </td>
                        {rules.lateFeeMode === 'slab' ? (
                          <>
                            <td>₹{p.schoolLateFee}</td>
                            <td>
                              <input
                                className="ep-input"
                                type="number"
                                min={0}
                                step="0.01"
                                name={`lateFee:${p.periodId}`}
                                defaultValue={p.lateFeeAmount ?? ''}
                                disabled={!canManage}
                                aria-label={`${p.name}: class late fee`}
                              />
                            </td>
                            <td>
                              <div
                                style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                              >
                                {[1, 2, 3].map((i) => (
                                  <span
                                    key={i}
                                    style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                                  >
                                    <input
                                      className="ep-input"
                                      type="date"
                                      name={`slabOn${i}:${p.periodId}`}
                                      defaultValue={p.slabs[i - 1]?.on ?? ''}
                                      disabled={!canManage}
                                      aria-label={`${p.name}: slab ${i} from date`}
                                    />
                                    <input
                                      className="ep-input"
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      name={`slabAmt${i}:${p.periodId}`}
                                      defaultValue={p.slabs[i - 1]?.amount ?? ''}
                                      disabled={!canManage}
                                      aria-label={`${p.name}: slab ${i} amount`}
                                    />
                                  </span>
                                ))}
                              </div>
                            </td>
                          </>
                        ) : (
                          <td>
                            <input
                              className="ep-input"
                              type="number"
                              min={0}
                              step="0.01"
                              name={`perDay:${p.periodId}`}
                              defaultValue={p.latePerDay ?? ''}
                              disabled={!canManage}
                              aria-label={`${p.name}: class late fee per day`}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 'var(--sp-4)', maxWidth: '22rem' }}>
                <InputField
                  id="bounceCharge"
                  name="bounceCharge"
                  label="Cheque-bounce charge of this class"
                  help={`School charge: ₹${rules.schoolBounceCharge}. Empty = the school's.`}
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={rules.bounceCharge ?? ''}
                  disabled={!canManage}
                />
              </div>
              {canManage ? (
                <FormActions>
                  <Button type="submit">Save class rules</Button>
                </FormActions>
              ) : null}
            </form>
          ) : null}
        </Card>

        <Card title="Payment modes">
          <p className="ep-field__help">
            Tick what the counter accepts and what must be filled before a receipt is saved. Online
            is the payment gateway and is never typed at the counter.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Payment modes and their mandatory fields</caption>
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  <th scope="col">Name shown</th>
                  <th scope="col">At the counter</th>
                  <th scope="col">Reference / UTR no.</th>
                  <th scope="col">Cheque / DD no.</th>
                  <th scope="col">Cheque / DD date</th>
                  <th scope="col">Bank name</th>
                  <th scope="col">
                    <span className="ep-sr-only">Save</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {modes.map((m) => {
                  const form = `mode-${m.code}`;
                  const tick = (name: string, label: string, on: boolean, off = false) => (
                    <td>
                      <Checkbox
                        id={`${form}-${name}`}
                        name={name}
                        form={form}
                        label={<span className="ep-sr-only">{`${m.label}: ${label}`}</span>}
                        defaultChecked={on}
                        disabled={!canManage || off}
                      />
                    </td>
                  );
                  return (
                    <tr key={m.code}>
                      <th scope="row">{m.code.toUpperCase()}</th>
                      <td>
                        <input
                          className="ep-input"
                          name="label"
                          form={form}
                          defaultValue={m.label}
                          required
                          maxLength={40}
                          disabled={!canManage}
                          aria-label={`${m.code}: name shown`}
                        />
                      </td>
                      {tick(
                        'atCounter',
                        'accepted at the counter',
                        m.atCounter,
                        m.code === 'online',
                      )}
                      {tick('needReference', 'reference number mandatory', m.needReference)}
                      {tick('needInstrumentNo', 'cheque number mandatory', m.needInstrumentNo)}
                      {tick('needInstrumentDate', 'cheque date mandatory', m.needInstrumentDate)}
                      {tick('needBank', 'bank name mandatory', m.needBank)}
                      <td>
                        <form id={form} action={savePaymentMode}>
                          <input type="hidden" name="code" value={m.code} />
                          {canManage ? (
                            <Button type="submit" variant="secondary" size="sm">
                              Save
                            </Button>
                          ) : null}
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
