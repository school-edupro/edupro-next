import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PaymentTerms } from '@/components/purchase/PaymentTerms';
import { TermImport } from '@/components/purchase/TermImport';
import { apiFetch, getMe } from '@/lib/api';
import type { PaymentTerm } from '@/lib/purchase';

const KINDS = {
  advance: 'Has an advance',
  delivery: 'After delivery',
  invoice: 'After the invoice',
};

/**
 * Payment terms in instalments (docs/design/83, part 1): filtered by search, status, how a term pays
 * and longer than 45 days (the MSME warning); the list as Excel or PDF with the filters kept; terms
 * uploaded from Excel (a code there updates its term).
 */
export default async function PaymentTermsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const canManage = me.permissions.includes('purchase.master.manage');
  const f = {
    q: (sp.q ?? '').trim().slice(0, 80),
    status: sp.status === 'active' || sp.status === 'inactive' ? sp.status : '',
    kind: sp.kind && sp.kind in KINDS ? sp.kind : '',
    over45: sp.over45 === '1' ? '1' : '',
  };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { data: terms, total } = await apiFetch<{ data: PaymentTerm[]; total: number }>(
    `/purchase/payment-terms?${qs.toString()}`,
  );
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/payment-terms-file?${new URLSearchParams({ ...Object.fromEntries(qs), format }).toString()}`;
  const filtered = qs.toString() !== '';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Payment terms' }]} />
      <PageHeader
        kicker="Purchase"
        title="Payment terms"
        description="How a vendor is paid: one or more instalments, each due in advance, after delivery or after the invoice. A vendor has its own term (else the default); the PO copies it and prints it."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')} download>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')} download>
              PDF
            </a>
          </>
        }
      />
      <form method="get" action="/purchase/payment-terms" className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="pt-q">
          <span className="ep-field__label">Search</span>
          <input
            id="pt-q"
            name="q"
            className="ep-input"
            defaultValue={f.q}
            placeholder="Code or name"
            maxLength={80}
          />
        </label>
        <label className="ep-field" htmlFor="pt-status">
          <span className="ep-field__label">Status</span>
          <select id="pt-status" name="status" className="ep-select" defaultValue={f.status}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="ep-field" htmlFor="pt-kind">
          <span className="ep-field__label">Pays</span>
          <select id="pt-kind" name="kind" className="ep-select" defaultValue={f.kind}>
            <option value="">Any way</option>
            {Object.entries(KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-check" htmlFor="pt-45">
          <input
            id="pt-45"
            className="ep-check__input"
            type="checkbox"
            name="over45"
            value="1"
            defaultChecked={f.over45 === '1'}
          />
          <span className="ep-check__box" />
          Longer than 45 days
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Apply
        </button>
        {filtered ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/purchase/payment-terms">
            Clear
          </a>
        ) : null}
      </form>
      <p className="ep-field__help" role="status">
        {filtered
          ? `${String(terms.length)} of ${String(total)} payment terms. Excel and PDF keep these filters.`
          : `${String(total)} payment terms.`}{' '}
        Longer than 45 days: a micro or small vendor must be paid within 45 days, so the PO warns.
      </p>
      <PaymentTerms terms={terms} canManage={canManage} />
      {canManage ? <TermImport /> : null}
    </>
  );
}
