import { Badge, Breadcrumbs, Button, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { PurchaseOverview } from '@/lib/purchase';
import { copyFromSchool } from '@/lib/purchase-actions';

/**
 * Purchase set-up (docs/design/83, part 1; "As built — set-up in sections"): the figures, what waits for
 * a second person's approval and the HSN codes to fix, then three sections — rules and approvals, items
 * and GST, vendors — each opening its screens (they are not in the menu), and copying the masters from
 * another school of the group.
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
  const toFix = o.hsnToFix.length;
  /** a link of a section: Done / To do (null: optional, no badge), what it holds, where it goes */
  type Link = { done: boolean | null; title: string; text: string; href: string; flag?: string };
  const sections: Array<{ id: string; title: string; text: string; links: Link[] }> = [
    {
      id: 'pu-rules',
      title: '1. Rules and approvals',
      text: 'How the school buys, and who approves indents, requisitions and orders.',
      links: [
        {
          done: o.gstinSet,
          title: 'Purchase settings',
          text: 'GSTIN, numbering, sourcing limits, emergency purchase, PO terms',
          href: '/purchase/settings',
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
      ],
    },
    {
      id: 'pu-items',
      title: '2. Items and GST',
      text: 'What can be bought: units, GST codes, categories, items, rate contracts and payment terms.',
      links: [
        {
          done: o.uoms > 0,
          title: 'Units',
          text: `${String(o.uoms)} units`,
          href: '/masters/purchase?tab=purchase_uoms',
        },
        {
          done: o.hsn > 0 && !toFix,
          title: 'HSN / SAC codes',
          text: `${String(o.hsn)} GST codes (confirm rates with the CA)`,
          href: '/masters/purchase?tab=purchase_hsn',
          ...(toFix ? { flag: `${String(toFix)} to fix` } : {}),
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
          done: null,
          title: 'Rate contracts',
          text: `${String(o.rateContracts)} in force (optional: an agreed vendor and rate per item)`,
          href: '/masters/purchase?tab=purchase_rate_contracts',
        },
        {
          done: o.paymentTerms > 0,
          title: 'Payment terms',
          text: `${String(o.paymentTerms)} terms`,
          href: '/purchase/payment-terms',
        },
      ],
    },
    {
      id: 'pu-vendors',
      title: '3. Vendors',
      text: 'Who the school buys from. A new vendor, or a change of its bank, GSTIN or PAN, waits for a second person’s approval.',
      links: [
        {
          done: o.vendors > 0,
          title: 'Vendors',
          text: `${String(o.vendors)} active${o.blacklisted ? `, ${String(o.blacklisted)} blacklisted` : ''}`,
          href: '/purchase/vendors',
        },
        {
          done: null,
          title: 'Vendor approvals',
          text: waiting
            ? 'New vendors and bank / GSTIN / PAN changes to approve'
            : 'Nothing waits for approval',
          href: '/purchase/vendor-approvals',
          ...(waiting ? { flag: `${String(waiting)} waiting` } : {}),
        },
      ],
    },
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase' }]} />
      <PageHeader
        kicker="Purchase"
        title="Purchase set-up"
        description="Everything a Purchase Indent, Requisition and Order pick from, in three sections. Fill them in order: the rules, then items and GST, then vendors."
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
          <a style={{ textDecoration: 'underline' }} href="/purchase/vendor-approvals">
            Open Vendor approvals
          </a>
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
      <div className="ep-setup-sections">
        {sections.map((x) => (
          <section key={x.id} className="ep-card" aria-labelledby={x.id}>
            <h2 id={x.id} className="ep-card__title">
              {x.title}
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {x.text}
            </p>
            <ul className="ep-setup-links">
              {x.links.map((l) => (
                <li key={l.title}>
                  <a href={l.href}>
                    <strong>{l.title}</strong>
                  </a>{' '}
                  {l.flag ? (
                    <Badge tone="warning">{l.flag}</Badge>
                  ) : l.done === null ? null : (
                    <Badge tone={l.done ? 'success' : 'neutral'}>{l.done ? 'Done' : 'To do'}</Badge>
                  )}
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!canSettings ? (
        <p className="ep-field__help">
          The settings, the committee and who approves are kept by the school admin.
        </p>
      ) : null}
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
