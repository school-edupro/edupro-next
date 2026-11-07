import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { GST_STATUS, type Vendor, type VendorChange } from '@/lib/purchase';
import { decideVendor, decideVendorChange } from '@/lib/purchase-actions';

type Approvals = {
  vendors: Array<Vendor & { mine: boolean }>;
  changes: Array<
    VendorChange & { vendor: { id: string; code: string; legalName: string }; mine: boolean }
  >;
  /** the vendor approvers named in Purchase → Settings, else the right */
  canApprove: boolean;
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * Vendor approvals (docs/design/83, part 1): new vendors and changes of an approved vendor's bank
 * account, GSTIN or PAN, waiting for a second person. The person who entered one never approves it; the
 * approver sees the bank account in full.
 */
export default async function VendorApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const q = await apiFetch<Approvals>('/purchase/vendor-approvals');
  const canApprove = q.canApprove;
  const back = '/purchase/vendor-approvals';
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Vendor approvals' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Vendor approvals"
        description="New vendors and changes of a vendor’s bank account, GSTIN or PAN wait here for a second person. Check them against the documents; nobody approves what they entered."
      />
      <Notice params={sp} />
      {!canApprove ? (
        <p className="ep-alert ep-alert--info" role="status">
          You can see what waits; a vendor approver (Purchase → Settings → Vendor approval)
          approves it.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="va-new">
        <h2 id="va-new" className="ep-card__title">
          New vendors · {q.vendors.length}
        </h2>
        {q.vendors.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="New vendors">
            <table className="ep-table">
              <caption className="ep-sr-only">New vendors waiting for approval</caption>
              <thead>
                <tr>
                  <th scope="col">Vendor</th>
                  <th scope="col">GST</th>
                  <th scope="col">Bank account</th>
                  <th scope="col">Entered</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.vendors.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <a href={`/purchase/vendors/${v.id}`}>
                        <strong>{v.code}</strong> {v.legalName}
                      </a>
                    </td>
                    <td>
                      {GST_STATUS[v.gstStatus]}
                      <span className="ep-mr-col__desc">
                        {[v.gstin, v.pan ? `PAN ${v.pan}` : null, v.state]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td>
                      {v.bank
                        ? `${v.bank.bankName} ${v.bank.accountNo} (${v.bank.ifsc}) · ${v.bank.holder}`
                        : (v.bankHint ?? '—')}
                    </td>
                    <td>
                      {v.createdBy ?? '—'}
                      <span className="ep-mr-col__desc">{when(v.createdAt)}</span>
                    </td>
                    <td>
                      {v.mine ? (
                        <Badge tone="neutral">You entered it</Badge>
                      ) : canApprove ? (
                        <span
                          style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                        >
                          <ConfirmAction
                            action={decideVendor}
                            fields={{ id: v.id, approve: '1', back }}
                            label="Approve"
                            title={`Approve ${v.code}?`}
                            confirmLabel="Approve"
                            variant="primary"
                          >
                            {`Once approved, ${v.legalName} can be used on PRs, POs and rate contracts.`}
                          </ConfirmAction>
                          <ConfirmAction
                            action={decideVendor}
                            fields={{ id: v.id, approve: '0', back }}
                            label="Reject"
                            title={`Reject ${v.code}?`}
                            confirmLabel="Reject"
                            variant="ghost"
                            confirmVariant="danger"
                            reason={{ label: 'Why it is rejected (the maker sees it)' }}
                          >
                            The vendor stays out of use; its maker can correct it and send it again.
                          </ConfirmAction>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            No new vendor waits.
          </p>
        )}
      </section>
      <section className="ep-card" aria-labelledby="va-ch" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="va-ch" className="ep-card__title">
          Changes of bank, GSTIN or PAN · {q.changes.length}
        </h2>
        {q.changes.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Changes">
            <table className="ep-table">
              <caption className="ep-sr-only">Changes waiting for approval</caption>
              <thead>
                <tr>
                  <th scope="col">Vendor</th>
                  <th scope="col">Now</th>
                  <th scope="col">After the change</th>
                  <th scope="col">Asked</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.changes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`/purchase/vendors/${c.vendor.id}`}>
                        <strong>{c.vendor.code}</strong> {c.vendor.legalName}
                      </a>
                    </td>
                    <td>
                      {[
                        c.before.gstin,
                        c.before.pan ? `PAN ${c.before.pan}` : null,
                        c.before.bankHint,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td>
                      {[
                        c.changes.gstin !== c.before.gstin ? c.changes.gstin : null,
                        c.changes.pan !== c.before.pan && c.changes.pan
                          ? `PAN ${c.changes.pan}`
                          : null,
                        c.changes.bank
                          ? `${c.changes.bank.bankName} ${c.changes.bank.accountNo} (${c.changes.bank.ifsc}) · ${c.changes.bank.holder}`
                          : c.changes.bankHint,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td>
                      {c.requestedBy ?? '—'}
                      <span className="ep-mr-col__desc">
                        {when(c.requestedAt)}
                        {c.reason ? ` · ${c.reason}` : ''}
                      </span>
                    </td>
                    <td>
                      {c.mine ? (
                        <Badge tone="neutral">You asked for it</Badge>
                      ) : canApprove ? (
                        <span
                          style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                        >
                          <ConfirmAction
                            action={decideVendorChange}
                            fields={{ id: c.id, approve: '1', back }}
                            label="Approve"
                            title={`Approve the change of ${c.vendor.code}?`}
                            confirmLabel="Approve"
                            variant="primary"
                          >
                            Check the new details against the documents (a cancelled cheque for a
                            bank account). Once approved they are in force.
                          </ConfirmAction>
                          <ConfirmAction
                            action={decideVendorChange}
                            fields={{ id: c.id, approve: '0', back }}
                            label="Reject"
                            title={`Reject the change of ${c.vendor.code}?`}
                            confirmLabel="Reject"
                            variant="ghost"
                            confirmVariant="danger"
                            reason={{ label: 'Why it is rejected' }}
                          >
                            The vendor keeps its present details.
                          </ConfirmAction>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            No change waits.
          </p>
        )}
      </section>
    </>
  );
}
