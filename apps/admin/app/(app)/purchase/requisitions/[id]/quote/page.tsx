import { Breadcrumbs, FormActions, FormRow, FormSection, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { inr, type RequisitionDetail, type RequisitionFormLists } from '@/lib/purchase';
import { saveQuote } from '@/lib/purchase-actions';

/**
 * A vendor's quote on a requisition (docs/design/83, part 3): its reference, date, validity, delivery
 * days and the file, and a rate per line the vendor quoted (a line left empty: not quoted). The GST is
 * the item's unless typed; an unregistered or composition vendor charges none.
 */
export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.requisition.manage')) notFound();
  const pr = await apiFetch<RequisitionDetail>(`/purchase/requisitions/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    },
  );
  if (!pr.can.edit) notFound();
  const lists = await apiFetch<RequisitionFormLists>('/purchase/requisition-form');
  const quote = sp.quoteId ? pr.quotes.find((q) => q.id === sp.quoteId) : undefined;
  if (sp.quoteId && !quote) notFound();
  const taken = new Set(pr.quotes.map((q) => q.vendorId));
  const vendors = lists.vendors.filter((v) => !taken.has(v.id) || v.id === quote?.vendorId);
  const buy = pr.lineItems.filter((l) => l.fulfil === 'buy');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Requisitions', href: '/purchase/requisitions' },
          { label: pr.number, href: `/purchase/requisitions/${pr.id}` },
          { label: quote ? `Quote of ${quote.vendor}` : 'Add a quote' },
        ]}
      />
      <PageHeader
        kicker={`Purchase · ${pr.number}`}
        title={quote ? `Quote of ${quote.vendor}` : 'Add a quote'}
        description="Enter the vendor’s rate for each line it quoted (before GST); leave a line empty if it did not quote it. Changing a quote clears the committee’s signatures."
      />
      <Notice params={sp} />
      <form action={saveQuote}>
        <input type="hidden" name="id" value={pr.id} />
        {quote ? <input type="hidden" name="quoteId" value={quote.id} /> : null}
        <FormSection title="The quote">
          <FormRow columns={3}>
            <label className="ep-field" htmlFor="q-vendor">
              <span className="ep-field__label" data-required="true">
                Vendor
              </span>
              <select
                id="q-vendor"
                name="vendorId"
                className="ep-select"
                required
                defaultValue={quote?.vendorId ?? ''}
              >
                <option value="">Pick the vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.code})
                    {v.gstStatus !== 'regular' ? ` · ${v.gstStatus}: no GST` : ''}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">Only approved, active vendors.</span>
            </label>
            <label className="ep-field" htmlFor="q-ref">
              <span className="ep-field__label">Quote reference</span>
              <input
                id="q-ref"
                name="quoteRef"
                className="ep-input"
                maxLength={60}
                defaultValue={quote?.quoteRef ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="q-days">
              <span className="ep-field__label">Delivery in (days)</span>
              <input
                id="q-days"
                name="deliveryDays"
                className="ep-input"
                inputMode="numeric"
                defaultValue={quote?.deliveryDays ?? ''}
              />
            </label>
          </FormRow>
          <FormRow columns={3}>
            <label className="ep-field" htmlFor="q-date">
              <span className="ep-field__label">Quote date</span>
              <input
                id="q-date"
                name="quoteDate"
                type="date"
                className="ep-input"
                defaultValue={quote?.quoteDate ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="q-valid">
              <span className="ep-field__label">Valid until</span>
              <input
                id="q-valid"
                name="validUntil"
                type="date"
                className="ep-input"
                defaultValue={quote?.validUntil ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="q-file">
              <span className="ep-field__label">
                {quote?.fileId ? 'Replace the quote file' : 'The quote (PDF or photo)'}
              </span>
              <input
                id="q-file"
                name="file"
                type="file"
                className="ep-input"
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
              <span className="ep-field__help">Up to 5 MB.</span>
            </label>
          </FormRow>
          <label className="ep-field" htmlFor="q-note">
            <span className="ep-field__label">Note</span>
            <input
              id="q-note"
              name="note"
              className="ep-input"
              maxLength={500}
              defaultValue={quote?.note ?? ''}
              placeholder="Warranty, freight, installation…"
            />
          </label>
        </FormSection>
        <FormSection title="Rates">
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rates per line">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Quantity
                  </th>
                  <th scope="col">Rate before GST (₹)</th>
                  <th scope="col">GST %</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {buy.map((l) => {
                  const q = quote?.lines.find((x) => x.lineId === l.id);
                  return (
                    <tr key={l.id}>
                      <td>
                        <input type="hidden" name="lineId" value={l.id} />
                        {l.seq}. {l.item}
                        <span className="ep-mr-col__desc">Estimate {inr(l.estRate)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {l.quantity} {l.uom}
                      </td>
                      <td>
                        <input
                          name={`rate_${l.id}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Rate of ${l.item}`}
                          defaultValue={q?.rate ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`gst_${l.id}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`GST % of ${l.item}`}
                          defaultValue={q?.gstRate ?? ''}
                          placeholder={l.itemGst !== null ? String(l.itemGst) : '0'}
                        />
                      </td>
                      <td>
                        <input
                          name={`note_${l.id}`}
                          className="ep-input"
                          maxLength={300}
                          aria-label={`Note on ${l.item}`}
                          defaultValue={q?.note ?? ''}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="ep-field__help">
            GST left empty: the item’s rate (shown faintly). An unregistered or composition vendor
            charges no GST.
          </p>
        </FormSection>
        <FormActions>
          <a className="ep-btn ep-btn--ghost" href={`/purchase/requisitions/${pr.id}`}>
            Cancel
          </a>
          <button type="submit" className="ep-btn ep-btn--primary">
            {quote ? 'Save the quote' : 'Add the quote'}
          </button>
        </FormActions>
      </form>
    </>
  );
}
