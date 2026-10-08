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
import { ClassCalendarEditor } from '@/components/fees/ClassCalendarEditor';
import type { CalendarPeriod } from '@/components/fees/ClassCalendarGrid';
import { GridTools } from '@/components/fees/GridTools';
import { createFeeMonths, importClassCalendar } from '@/lib/fee-grid-actions';
import {
  addPaymentMode,
  cloneClassRules,
  removePaymentMode,
  saveClassRules,
  savePaymentMode,
} from '@/lib/fee-setup-actions';
import type { ClassRow, Page } from '@/lib/types';

interface ClassRules {
  classId: string;
  bounceCharge: string | null;
  schoolBounceCharge: string;
  lateFeeMode: 'slab' | 'daywise';
  classLateMode: 'slab' | 'daywise' | null;
  schoolLateMode: 'slab' | 'daywise';
  classLatePerDay: string | null;
  lateMax: string | null;
  schoolLatePerDay: string;
  periods: CalendarPeriod[];
}
interface PaymentMode {
  code: string;
  kind: string;
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
                <ClassCalendarEditor rules={rules} canManage={canManage} />
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
                sample={false}
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
                      <th scope="row">
                        {m.code === m.kind ? m.code.toUpperCase() : `Like ${m.kind.toUpperCase()}`}
                      </th>
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
                            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                              <Button type="submit" variant="secondary" size="sm">
                                Save
                              </Button>
                              {m.code !== m.kind ? (
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  formAction={removePaymentMode.bind(null, m.code)}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </span>
                          ) : null}
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={addPaymentMode} style={{ marginTop: 'var(--sp-4)' }}>
              <h3 className="ep-h4">Add a payment mode</h3>
              <p className="ep-field__help">
                For example “NEFT / RTGS”, “Paytm QR” or “POS machine”. Choose the built-in mode it
                works like: that decides how it is treated (a mode like Cheque can bounce and goes
                on the deposit slip). The cashier sees the new name; receipts and the day book show
                it.
              </p>
              <FormRow columns={4}>
                <InputField
                  id="newModeLabel"
                  name="label"
                  label="Name"
                  required
                  minLength={2}
                  maxLength={40}
                />
                <SelectField
                  id="newModeKind"
                  name="kind"
                  label="Works like"
                  options={[
                    { value: 'bank', label: 'Bank transfer' },
                    { value: 'upi', label: 'UPI' },
                    { value: 'card', label: 'Card' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'cheque', label: 'Cheque' },
                    { value: 'dd', label: 'Demand draft' },
                  ]}
                />
              </FormRow>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Checkbox
                  id="newModeRef"
                  name="needReference"
                  label="Reference / UTR no. mandatory"
                />
                <Checkbox
                  id="newModeNo"
                  name="needInstrumentNo"
                  label="Cheque / DD no. mandatory"
                />
                <Checkbox
                  id="newModeDate"
                  name="needInstrumentDate"
                  label="Cheque / DD date mandatory"
                />
                <Checkbox id="newModeBank" name="needBank" label="Bank name mandatory" />
              </div>
              <FormActions>
                <Button type="submit" variant="secondary">
                  Add payment mode
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
