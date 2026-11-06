import { Breadcrumbs, FormActions, FormRow, FormSection, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { OrderFormLists } from '@/lib/purchase';
import { recordEmergency } from '@/lib/purchase-actions';

const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * Record an emergency purchase (docs/design/83, part 4): made before any indent or requisition (a pipe
 * burst, a broken generator); the vendor, what was bought, the vendor's bill and why it could not
 * wait. It goes for ratification; it is marked Emergency everywhere.
 */
export default async function EmergencyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.emergency.record')) notFound();
  const lists = await apiFetch<OrderFormLists>('/purchase/order-form');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Orders', href: '/purchase/orders' },
          { label: 'Emergency purchase' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="Record an emergency purchase"
        description={`For a purchase that could not wait for an indent and a requisition. Attach the vendor's bill and say why; everyone with the designation ${lists.emergencyRatifier} ratifies it.`}
      />
      <Notice params={sp} />
      {!lists.emergencyEnabled ? (
        <p className="ep-alert ep-alert--warning" role="status">
          Emergency purchase is switched off on <a href="/purchase/settings">Purchase settings</a>.
        </p>
      ) : (
        <form action={recordEmergency}>
          <FormSection title="The purchase">
            <FormRow columns={3}>
              <label className="ep-field" htmlFor="em-v">
                <span className="ep-field__label" data-required="true">
                  Vendor
                </span>
                <select id="em-v" name="vendorId" className="ep-select" required defaultValue="">
                  <option value="">Pick the vendor</option>
                  {lists.vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.code})
                    </option>
                  ))}
                </select>
                <span className="ep-field__help">Only approved, active vendors.</span>
              </label>
              <label className="ep-field" htmlFor="em-d">
                <span className="ep-field__label">Department</span>
                <select
                  id="em-d"
                  name="departmentId"
                  className="ep-select"
                  defaultValue={lists.purchaseDepartmentId ?? ''}
                >
                  <option value="">Not given</option>
                  {lists.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="em-date">
                <span className="ep-field__label">Bought on</span>
                <input
                  id="em-date"
                  name="poDate"
                  type="date"
                  className="ep-input"
                  max={today}
                  defaultValue={today}
                />
              </label>
            </FormRow>
            <label className="ep-field" htmlFor="em-why">
              <span className="ep-field__label" data-required="true">
                Why it could not wait
              </span>
              <textarea
                id="em-why"
                name="reason"
                className="ep-input"
                rows={2}
                minLength={10}
                maxLength={1000}
                required
                placeholder="e.g. a pipe burst in the junior block on Sunday night"
              />
            </label>
            <FormRow columns={2}>
              <label className="ep-field" htmlFor="em-bill">
                <span className="ep-field__label" data-required="true">
                  The vendor’s bill (PDF or photo)
                </span>
                <input
                  id="em-bill"
                  name="bill"
                  type="file"
                  className="ep-input"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  required
                />
                <span className="ep-field__help">Up to 5 MB.</span>
              </label>
              <label className="ep-field" htmlFor="em-ref">
                <span className="ep-field__label">Bill number</span>
                <input id="em-ref" name="billRef" className="ep-input" maxLength={60} />
              </label>
            </FormRow>
          </FormSection>
          <FormSection
            title="What was bought"
            description="Pick an item, or describe it with its unit. Rates before GST; the GST is the item's unless typed."
          >
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="What was bought">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Or in words</th>
                    <th scope="col">Unit (for words)</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Rate (₹)</th>
                    <th scope="col">GST %</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((i) => {
                    const n = String(i + 1);
                    return (
                      <tr key={i}>
                        <td>
                          <select
                            name={`item_${String(i)}`}
                            className="ep-select"
                            aria-label={`Item ${n}`}
                            defaultValue=""
                          >
                            <option value="">—</option>
                            {lists.items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name} ({it.code})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            name={`desc_${String(i)}`}
                            className="ep-input"
                            maxLength={300}
                            aria-label={`Item ${n} in words`}
                          />
                        </td>
                        <td>
                          <select
                            name={`uom_${String(i)}`}
                            className="ep-select"
                            aria-label={`Unit of item ${n}`}
                            defaultValue=""
                          >
                            <option value="">—</option>
                            {lists.uoms.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            name={`qty_${String(i)}`}
                            className="ep-input"
                            inputMode="decimal"
                            aria-label={`Quantity of item ${n}`}
                          />
                        </td>
                        <td>
                          <input
                            name={`rate_${String(i)}`}
                            className="ep-input"
                            inputMode="decimal"
                            aria-label={`Rate of item ${n}`}
                          />
                        </td>
                        <td>
                          <input
                            name={`gst_${String(i)}`}
                            className="ep-input"
                            inputMode="decimal"
                            aria-label={`GST % of item ${n}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FormSection>
          <FormActions>
            <a className="ep-btn ep-btn--ghost" href="/purchase/orders">
              Cancel
            </a>
            <button type="submit" className="ep-btn ep-btn--primary">
              Record it
            </button>
          </FormActions>
        </form>
      )}
    </>
  );
}
