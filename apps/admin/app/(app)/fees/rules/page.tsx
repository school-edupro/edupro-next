import {
  Button,
  Card,
  Checkbox,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { apiFetch, getMe } from '@/lib/api';
import { ClassCalendarGrid, type CalendarPeriod } from '@/components/fees/ClassCalendarGrid';
import { GridTools } from '@/components/fees/GridTools';
import { createFeeMonths, importClassCalendar } from '@/lib/fee-grid-actions';
import { cloneClassRules, saveClassRules, savePaymentMode } from '@/lib/fee-setup-actions';
import type { ClassRow, Page } from '@/lib/types';

interface ClassRules {
  classId: string;
  bounceCharge: string | null;
  schoolBounceCharge: string;
  lateFeeMode: 'slab' | 'daywise';
  classLateMode: 'slab' | 'daywise' | null;
  classLatePerDay: string | null;
  lateMax: string | null;
  schoolLatePerDay: string;
  periods: CalendarPeriod[];
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
        title="Class calendar, late fee and payment modes"
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
            <>
              <form action={saveClassRules} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="classId" value={cls.id} />
                <FormRow columns={4}>
                  <SelectField
                    id="lateMode"
                    name="lateMode"
                    label="Late fee of this class"
                    defaultValue={rules.classLateMode ?? ''}
                    disabled={!canManage}
                    options={[
                      { value: '', label: 'As the school' },
                      { value: 'daywise', label: 'Per day after the last date' },
                      { value: 'slab', label: 'By slabs (dates and amounts)' },
                    ]}
                  />
                  <InputField
                    id="latePerDay"
                    name="latePerDay"
                    label="Per day (₹)"
                    help={`School: ₹${rules.schoolLatePerDay} a day`}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={rules.classLatePerDay ?? ''}
                    disabled={!canManage}
                  />
                  <InputField
                    id="lateMax"
                    name="lateMax"
                    label="Maximum per instalment (₹)"
                    help="Per-day only. Empty = no limit."
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={rules.lateMax ?? ''}
                    disabled={!canManage}
                  />
                  <InputField
                    id="bounceCharge"
                    name="bounceCharge"
                    label="Bounce charge of the class (₹)"
                    help={`School: ₹${rules.schoolBounceCharge}. A month’s own Bounce wins.`}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={rules.bounceCharge ?? ''}
                    disabled={!canManage}
                  />
                </FormRow>
                <p className="ep-field__help">
                  In force now:{' '}
                  <strong>{rules.lateFeeMode === 'slab' ? 'slabs' : 'per day'}</strong>. Per day:
                  the rate above is charged for every day after the last date. Slabs: “Late fees”
                  applies after the last date; after “Last date 1” the fee becomes “Late fee 1”, and
                  so on (the later amount replaces the earlier one). An empty box follows the
                  school. Months with the same last date form one instalment. Show = No hides the
                  instalment from parents; Fee pay = No lets them see it but not pay online. Unpaid
                  bills move to a new last date as soon as you save.
                </p>
                <ClassCalendarGrid periods={rules.periods} canManage={canManage} />
                {rules.periods.length === 0 ? (
                  <p className="ep-field__help">
                    This year has no fee months yet: use “Create the twelve months” below.
                  </p>
                ) : null}
                {canManage ? (
                  <FormActions>
                    <Button type="submit">Save the calendar of {cls.name}</Button>
                  </FormActions>
                ) : null}
              </form>
              <GridTools
                fileHref={`/api/fees/grid-file?kind=calendar&classId=${cls.id}`}
                upload={importClassCalendar}
                hidden={[['classId', cls.id]]}
                canManage={canManage}
              />
              {canManage && rules.periods.length === 0 ? (
                <form action={createFeeMonths}>
                  <input type="hidden" name="back" value={`/fees/rules?classId=${cls.id}`} />
                  <Button type="submit">Create the twelve months</Button>
                </form>
              ) : null}
              {canManage ? (
                <form action={cloneClassRules} style={{ marginTop: 'var(--sp-5)' }}>
                  <input type="hidden" name="classId" value={cls.id} />
                  <fieldset>
                    <legend className="ep-field__label">
                      Clone the saved calendar of {cls.name} to other classes
                    </legend>
                    <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                      {classes
                        .filter((k) => k.id !== cls.id)
                        .map((k) => (
                          <Checkbox
                            key={k.id}
                            id={`clone-${k.id}`}
                            name="toClassIds"
                            value={k.id}
                            label={k.code}
                          />
                        ))}
                    </div>
                  </fieldset>
                  <p className="ep-field__help">
                    Save first. Cloning replaces the whole calendar of the ticked classes.
                  </p>
                  <FormActions>
                    <Button type="submit" variant="secondary">
                      Clone to the ticked classes
                    </Button>
                  </FormActions>
                </form>
              ) : null}
            </>
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
