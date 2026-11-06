import { Breadcrumbs, Button, FormActions, FormRow, FormSection, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { DepartmentApprovals, PurchaseSettings } from '@/lib/purchase';
import {
  addCommitteeMember,
  addCondemnationMember,
  removeCommitteeMember,
  removeCondemnationMember,
  saveCondemnationSignatures,
  savePurchaseSettings,
} from '@/lib/purchase-actions';

/**
 * Purchase settings (docs/design/83, part 1): the school's GSTIN and addresses, numbering, the sourcing
 * tiers (GFR 2017 limits by default), emergency purchase, the PO's validity, terms and signatures, the
 * department that approves combined PRs, the large-PO alert and the split window; and the purchase
 * committee that signs comparative statements.
 */
export default async function PurchaseSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const can = me.permissions.includes('purchase.settings.manage');
  const [s, a, cc] = await Promise.all([
    apiFetch<PurchaseSettings>('/purchase/settings'),
    apiFetch<DepartmentApprovals>('/purchase/approvals'),
    apiFetch<{
      signatures: number | null;
      members: Array<{
        id: string;
        employeeId: string;
        name: string;
        code: string;
        designation: string | null;
        role: string | null;
        signsIn: boolean;
      }>;
    }>('/purchase/condemnation-committee'),
  ]);
  const inCondemnation = new Set(cc.members.map((m) => m.employeeId));
  const inCommittee = new Set(s.committee.map((m) => m.employeeId));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Settings' }]} />
      <PageHeader
        kicker="Purchase"
        title="Purchase settings"
        description="Kept by the school admin. The sourcing limits start at the GFR 2017 figures; a private school may set its own."
      />
      <Notice params={sp} />
      <form action={savePurchaseSettings}>
        <fieldset disabled={!can} style={{ border: 0, padding: 0, margin: 0 }}>
          <FormSection
            title="The school"
            description={
              s.state
                ? `GST state: ${s.state}. A vendor in this state is charged CGST + SGST; one in another state IGST.`
                : 'The GSTIN gives the school’s state, which decides CGST + SGST or IGST on a PO.'
            }
          >
            <FormRow columns={3}>
              <label className="ep-field" htmlFor="ps-gstin">
                <span className="ep-field__label">The school’s GSTIN</span>
                <input
                  id="ps-gstin"
                  name="gstin"
                  className="ep-input"
                  defaultValue={s.gstin ?? ''}
                  maxLength={15}
                />
              </label>
              <label className="ep-field" htmlFor="ps-bill">
                <span className="ep-field__label">Billing address (on the PO)</span>
                <input
                  id="ps-bill"
                  name="billingAddress"
                  className="ep-input"
                  defaultValue={s.billingAddress ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ps-del">
                <span className="ep-field__label">Delivery address</span>
                <input
                  id="ps-del"
                  name="deliveryAddress"
                  className="ep-input"
                  defaultValue={s.deliveryAddress ?? ''}
                />
              </label>
            </FormRow>
          </FormSection>
          <FormSection
            title="Numbering"
            description="The number of each document, restarting every financial year: PO/2026-27/0001."
          >
            <FormRow columns={3}>
              {(
                [
                  ['piPrefix', 'Purchase Indent', s.piPrefix],
                  ['prPrefix', 'Purchase Requisition', s.prPrefix],
                  ['poPrefix', 'Purchase Order', s.poPrefix],
                ] as const
              ).map(([k, label, v]) => (
                <label key={k} className="ep-field" htmlFor={`ps-${k}`}>
                  <span className="ep-field__label">{label} prefix</span>
                  <input
                    id={`ps-${k}`}
                    name={k}
                    className="ep-input"
                    defaultValue={v}
                    maxLength={10}
                    required
                  />
                </label>
              ))}
            </FormRow>
          </FormSection>
          <FormSection
            title="Sourcing by value"
            description="Up to the direct limit one quote and a reasonable-price certificate are enough; up to the committee limit the PR needs the quotes and the committee’s signed comparative statement; above it, a tender reference."
          >
            <FormRow columns={4}>
              <label className="ep-field" htmlFor="ps-direct">
                <span className="ep-field__label">Direct purchase up to (₹)</span>
                <input
                  id="ps-direct"
                  name="directLimit"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={String(s.directLimit)}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ps-comm">
                <span className="ep-field__label">Committee up to (₹)</span>
                <input
                  id="ps-comm"
                  name="committeeLimit"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={String(s.committeeLimit)}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ps-quotes">
                <span className="ep-field__label">Quotes needed</span>
                <input
                  id="ps-quotes"
                  name="committeeQuotes"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={String(s.committeeQuotes)}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ps-sign">
                <span className="ep-field__label">Committee signatures needed</span>
                <input
                  id="ps-sign"
                  name="committeeSignatures"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={s.committeeSignatures === null ? '' : String(s.committeeSignatures)}
                  placeholder="Empty: every member"
                />
              </label>
            </FormRow>
            <label className="ep-check" htmlFor="ps-emerg">
              <input
                id="ps-emerg"
                name="emergencyEnabled"
                className="ep-check__input"
                type="checkbox"
                defaultChecked={s.emergencyEnabled}
              />
              <span className="ep-check__box" />
              Allow emergency purchases (recorded after the fact, with the vendor’s bill; ratified
              afterwards)
            </label>
            <FormRow columns={3}>
              <label className="ep-field" htmlFor="ps-ratifier">
                <span className="ep-field__label">Who ratifies them (designation)</span>
                <input
                  id="ps-ratifier"
                  name="emergencyRatifier"
                  className="ep-input"
                  maxLength={80}
                  defaultValue={s.emergencyRatifier}
                  required
                />
                <span className="ep-field__help">
                  Everyone with this designation; the school admin when nobody holds it.
                </span>
              </label>
            </FormRow>
          </FormSection>
          <FormSection title="Purchase order">
            <FormRow columns={3}>
              <label className="ep-field" htmlFor="ps-valid">
                <span className="ep-field__label">Valid for (days)</span>
                <input
                  id="ps-valid"
                  name="poValidityDays"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={String(s.poValidityDays)}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ps-sigs">
                <span className="ep-field__label">Signatures (comma separated)</span>
                <input
                  id="ps-sigs"
                  name="poSignatures"
                  className="ep-input"
                  defaultValue={s.poSignatures.join(', ')}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ps-dep">
                <span className="ep-field__label">Approves a PR combining departments</span>
                <select
                  id="ps-dep"
                  name="purchaseDepartmentId"
                  className="ep-select"
                  defaultValue={s.purchaseDepartmentId ?? ''}
                >
                  <option value="">—</option>
                  {a.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </FormRow>
            <label className="ep-field" htmlFor="ps-terms">
              <span className="ep-field__label">Terms and conditions (printed on the PO)</span>
              <textarea
                id="ps-terms"
                name="poTerms"
                className="ep-input"
                rows={4}
                defaultValue={s.poTerms ?? ''}
                maxLength={4000}
              />
            </label>
          </FormSection>
          <FormSection title="Checks">
            <FormRow columns={2}>
              <label className="ep-field" htmlFor="ps-alert">
                <span className="ep-field__label">List POs above (₹) on the dashboard</span>
                <input
                  id="ps-alert"
                  name="largePoAlert"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={s.largePoAlert === null ? '' : String(s.largePoAlert)}
                  placeholder="Empty: no list"
                />
                <span className="ep-field__help">
                  Information only: no approver is added by amount.
                </span>
              </label>
              <label className="ep-field" htmlFor="ps-split">
                <span className="ep-field__label">Split window (days)</span>
                <input
                  id="ps-split"
                  name="splitWindowDays"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={String(s.splitWindowDays)}
                  required
                />
                <span className="ep-field__help">
                  A department’s small PIs of one category within these days are added together
                  before a PI skips the PR.
                </span>
              </label>
            </FormRow>
          </FormSection>
          <FormSection
            title="Goods received"
            description="How the store takes in what comes against a PO."
          >
            <FormRow columns={2}>
              <label className="ep-field" htmlFor="ps-tol">
                <span className="ep-field__label">More than ordered allowed (%)</span>
                <input
                  id="ps-tol"
                  name="receiptTolerancePct"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={String(s.receiptTolerancePct)}
                />
                <span className="ep-field__help">
                  Per PO line; 0 refuses anything beyond the order. Most schools keep 0.
                </span>
              </label>
            </FormRow>
            <label className="ep-check" htmlFor="ps-gstcost">
              <input
                id="ps-gstcost"
                name="stockGstInCost"
                className="ep-check__input"
                type="checkbox"
                defaultChecked={s.stockGstInCost}
              />
              <span className="ep-check__box" />
              GST paid is part of the stock cost (leave on unless the school takes input tax credit)
            </label>
          </FormSection>
          {can ? (
            <FormActions>
              <Button type="submit">Save the settings</Button>
            </FormActions>
          ) : null}
        </fieldset>
      </form>

      <section
        id="committee"
        className="ep-card"
        aria-labelledby="ps-cm"
        style={{ marginTop: 'var(--sp-5)' }}
      >
        <h2 id="ps-cm" className="ep-card__title">
          Purchase committee · {s.committee.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Signs the comparative statement of a PR between the direct and the committee limit.
        </p>
        {s.committee.length ? (
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {s.committee.map((m) => (
              <li key={m.id} style={{ marginBottom: 'var(--sp-2)' }}>
                <strong>{m.name}</strong> ({m.code}){m.designation ? ` · ${m.designation}` : ''}
                {m.role ? ` · ${m.role}` : ''}{' '}
                {can ? (
                  <form action={removeCommitteeMember} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {can ? (
          <form
            action={addCommitteeMember}
            className="ep-grid__toolbar"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <label className="ep-field" htmlFor="ps-cm-emp">
              <span className="ep-field__label">Employee</span>
              <select
                id="ps-cm-emp"
                name="employeeId"
                className="ep-select"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Pick an employee
                </option>
                {a.staff
                  .filter((x) => !inCommittee.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.code}){x.designation ? ` · ${x.designation}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="ps-cm-role">
              <span className="ep-field__label">Role on the committee</span>
              <input
                id="ps-cm-role"
                name="role"
                className="ep-input"
                placeholder="Chair, member…"
                maxLength={60}
              />
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Add to the committee
            </Button>
          </form>
        ) : null}
      </section>

      <section
        id="condemnation"
        className="ep-card"
        aria-labelledby="ps-cdn"
        style={{ marginTop: 'var(--sp-5)' }}
      >
        <h2 id="ps-cdn" className="ep-card__title">
          Condemnation committee · {cc.members.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Recommends writing off unserviceable, obsolete or surplus assets and stock (GFR 2017 rule
          217) by signing the proposal; the school admin then approves it.
        </p>
        {cc.members.length ? (
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {cc.members.map((m) => (
              <li key={m.id} style={{ marginBottom: 'var(--sp-2)' }}>
                <strong>{m.name}</strong> ({m.code}){m.designation ? ` · ${m.designation}` : ''}
                {m.role ? ` · ${m.role}` : ''}
                {m.signsIn ? '' : ' · cannot sign in'}{' '}
                {can ? (
                  <form action={removeCondemnationMember} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {can ? (
          <>
            <form
              action={addCondemnationMember}
              className="ep-grid__toolbar"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <label className="ep-field" htmlFor="ps-cd-emp">
                <span className="ep-field__label">Employee</span>
                <select
                  id="ps-cd-emp"
                  name="employeeId"
                  className="ep-select"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Pick an employee
                  </option>
                  {a.staff
                    .filter((x) => !inCondemnation.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.code}){x.designation ? ` · ${x.designation}` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="ps-cd-role">
                <span className="ep-field__label">Role on the committee</span>
                <input
                  id="ps-cd-role"
                  name="role"
                  className="ep-input"
                  placeholder="Chair, member…"
                  maxLength={60}
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Add to the committee
              </Button>
            </form>
            <form
              action={saveCondemnationSignatures}
              className="ep-grid__toolbar"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <label className="ep-field" htmlFor="ps-cd-sig">
                <span className="ep-field__label">Signatures needed</span>
                <input
                  id="ps-cd-sig"
                  name="signatures"
                  className="ep-input"
                  inputMode="numeric"
                  defaultValue={cc.signatures === null ? '' : String(cc.signatures)}
                  placeholder="Empty: every member"
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </>
  );
}
