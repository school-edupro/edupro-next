import { Badge, Breadcrumbs, Button, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { PurchaseOverview } from '@/lib/purchase';
import { copyFromSchool } from '@/lib/purchase-actions';

/**
 * Purchase (docs/design/83, part 1): what the set-up has, in the order a school fills it, what waits for
 * a second person's approval, and copying the masters from another school of the group.
 */
export default async function PurchaseHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const canManage = me.permissions.includes('purchase.master.manage');
  const canSettings = me.permissions.includes('purchase.settings.manage');
  const [o, sources] = await Promise.all([
    apiFetch<PurchaseOverview>('/purchase/overview'),
    canManage
      ? apiFetch<{ data: Array<{ id: string; code: string; name: string }> }>(
          '/purchase/copy-sources',
        ).then((r) => r.data)
      : Promise.resolve([] as Array<{ id: string; code: string; name: string }>),
  ]);
  const waiting = o.vendorsPending + o.changesPending;
  const steps: Array<{ done: boolean; title: string; text: string; href: string }> = [
    {
      done: o.gstinSet,
      title: 'Settings',
      text: 'The school’s GSTIN, numbering, sourcing limits, PO terms',
      href: '/purchase/settings',
    },
    {
      done: o.uoms > 0 && o.hsn > 0,
      title: 'Units and HSN / SAC codes',
      text: `${String(o.uoms)} units, ${String(o.hsn)} GST codes (add what the school buys; confirm rates with the CA)`,
      href: '/masters/purchase?tab=purchase_hsn',
    },
    {
      done: o.categories > 0,
      title: 'Item categories',
      text: `${String(o.categories)} categories`,
      href: '/masters/purchase?tab=purchase_item_categories',
    },
    {
      done: o.items > 0,
      title: 'Items',
      text: `${String(o.items)} items`,
      href: '/masters/purchase?tab=purchase_items',
    },
    {
      done: o.paymentTerms > 0,
      title: 'Payment terms',
      text: `${String(o.paymentTerms)} terms`,
      href: '/purchase/payment-terms',
    },
    {
      done: o.vendors > 0,
      title: 'Vendors',
      text: `${String(o.vendors)} active${o.vendorsPending ? `, ${String(o.vendorsPending)} waiting for approval` : ''}`,
      href: '/purchase/vendors',
    },
    {
      done: o.departmentsSet > 0,
      title: 'Who approves',
      text: `Set for ${String(o.departmentsSet)} of ${String(o.departments)} departments`,
      href: '/purchase/approvals',
    },
    {
      done: o.committee > 0,
      title: 'Purchase committee',
      text: o.committee
        ? `${String(o.committee)} members`
        : 'Signs comparative statements above the direct-purchase limit',
      href: '/purchase/settings#committee',
    },
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase' }]} />
      <PageHeader
        kicker="Purchase"
        title="Purchase set-up"
        description="The masters a Purchase Indent, Requisition and Order pick from. Fill them in this order; a new vendor, or a change of a vendor’s bank, GSTIN or PAN, waits for a second person’s approval."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Items" value={String(o.items)} />
        <KpiTile label="Active vendors" value={String(o.vendors)} />
        <KpiTile label="Rate contracts in force" value={String(o.rateContracts)} />
        <KpiTile label="Waiting for approval" value={String(waiting)} />
      </div>
      {waiting ? (
        <p className="ep-alert ep-alert--warning" role="status">
          {o.vendorsPending
            ? `${String(o.vendorsPending)} new vendor${o.vendorsPending > 1 ? 's' : ''}`
            : ''}
          {o.vendorsPending && o.changesPending ? ' and ' : ''}
          {o.changesPending
            ? `${String(o.changesPending)} bank / GSTIN / PAN change${o.changesPending > 1 ? 's' : ''}`
            : ''}{' '}
          wait for a second person’s approval.{' '}
          <a href="/purchase/vendor-approvals">Open Vendor approvals</a>
        </p>
      ) : null}
      {o.hsnToFix.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>HSN / SAC codes to fix</strong> — a GST rate must be a slab (0, 0.25, 1.5, 3, 5,
            12, 18, 28 or 40) and an exempt code has 0%. A PO line takes its GST from these, so
            correct them in{' '}
            <a style={{ textDecoration: 'underline' }} href="/masters/purchase?tab=purchase_hsn">
              HSN / SAC codes
            </a>
            :
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {o.hsnToFix.map((h) => (
                <li key={h.code}>
                  {h.code} {h.description} — {h.gstRate}%{h.exempt ? ', marked exempt' : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <section className="ep-card" aria-labelledby="pu-steps" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="pu-steps" className="ep-card__title">
          Set-up, in order
        </h2>
        <ol className="ep-purch-steps">
          {steps.map((x) => (
            <li key={x.title}>
              <span>
                <a href={x.href}>
                  <strong>{x.title}</strong>
                </a>{' '}
                <Badge tone={x.done ? 'success' : 'neutral'}>{x.done ? 'Done' : 'To do'}</Badge>
                <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                  {x.text}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {!canSettings ? (
          <p className="ep-field__help">
            The settings, the committee and who approves are kept by the school admin.
          </p>
        ) : null}
      </section>
      {canManage && sources.length ? (
        <section className="ep-card" aria-labelledby="pu-copy" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="pu-copy" className="ep-card__title">
            Copy from another school of the group
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Rows whose code this school already has stay as they are. Items bring their categories,
            units and HSN codes; vendors arrive waiting for approval here, without their documents.
          </p>
          <form action={copyFromSchool} className="ep-form-section__body">
            <label className="ep-field" htmlFor="pu-copy-school">
              <span className="ep-field__label">School</span>
              <select id="pu-copy-school" name="schoolId" className="ep-select" required>
                {sources.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
              <legend className="ep-field__label">What to copy</legend>
              {(
                [
                  ['uoms', 'Units'],
                  ['hsn', 'HSN / SAC codes'],
                  ['categories', 'Item categories'],
                  ['items', 'Items (with their categories, units and HSN)'],
                  ['paymentTerms', 'Payment terms'],
                  ['vendors', 'Vendors (they wait for approval)'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="ep-check" htmlFor={`pu-copy-${v}`}>
                  <input
                    id={`pu-copy-${v}`}
                    className="ep-check__input"
                    type="checkbox"
                    name="parts"
                    value={v}
                  />
                  <span className="ep-check__box" />
                  {label}
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" variant="secondary" size="sm">
                Copy
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
