import { Badge, Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { VendorForm } from '@/components/purchase/VendorForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  DOC_KIND,
  GST_STATUS,
  VENDOR_KIND,
  VENDOR_STATUS,
  type VendorDetail,
} from '@/lib/purchase';
import {
  addVendorDocument,
  decideVendor,
  decideVendorChange,
  removeVendorDocument,
  setVendorStatus,
  withdrawVendorChange,
} from '@/lib/purchase-actions';
import { vendorFormLists } from '@/lib/purchase-load';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

/**
 * One vendor (docs/design/83, part 1): its status and who entered and approved it, a change of its bank,
 * GSTIN or PAN waiting for a second person, the documents, the status actions, and the form.
 */
export default async function VendorPage({
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
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const canManage = me.permissions.includes('purchase.master.manage');
  const canApprove = me.permissions.includes('purchase.vendor.approve');
  const v = await apiFetch<VendorDetail>(`/purchase/vendors/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const lists = canManage ? await vendorFormLists() : null;
  const st = VENDOR_STATUS[v.status];
  const ch = v.pendingChange;
  const back = `/purchase/vendors/${v.id}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Vendors', href: '/purchase/vendors' },
          { label: v.code },
        ]}
      />
      <PageHeader
        kicker="Purchase · Vendor"
        title={`${v.legalName} (${v.code})`}
        description={`${VENDOR_KIND[v.kind]} · ${GST_STATUS[v.gstStatus]}${v.gstin ? ` · ${v.gstin}` : ''}${v.state ? ` · ${v.state}` : ''}`}
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="vd-st">
        <h2 id="vd-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        <p style={{ marginTop: 0 }}>
          Entered by {v.createdBy ?? '—'} on {when(v.createdAt)}
          {v.approvedBy
            ? ` · ${v.status === 'rejected' ? 'rejected' : 'approved'} by ${v.approvedBy} on ${when(v.approvedAt)}`
            : ''}
          {v.statusReason ? ` · ${v.statusReason}` : ''}
        </p>
        {v.status === 'pending' ? (
          v.enteredByMe ? (
            <p className="ep-alert ep-alert--info" role="status">
              You entered this vendor: another person with the vendor-approve right approves it.
            </p>
          ) : canApprove ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <ConfirmAction
                action={decideVendor}
                fields={{ id: v.id, approve: '1', back }}
                label="Approve the vendor"
                title={`Approve ${v.code}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {`Check the GSTIN, PAN and bank account against the documents. Once approved, ${v.legalName} can be used on PRs, POs and rate contracts.`}
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
            </div>
          ) : (
            <p className="ep-field__help">Waiting for someone with the vendor-approve right.</p>
          )
        ) : null}
        {canManage &&
        (v.status === 'active' || v.status === 'inactive' || v.status === 'blacklisted') ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {v.status !== 'active' ? (
              <ConfirmAction
                action={setVendorStatus}
                fields={{ id: v.id, status: 'active' }}
                label="Make active"
                title={`Make ${v.code} active?`}
                confirmLabel="Make active"
                variant="secondary"
                reason={
                  v.status === 'blacklisted'
                    ? { label: 'Why it is taken off the blacklist' }
                    : undefined
                }
              >
                It can be used on PRs, POs and rate contracts again.
              </ConfirmAction>
            ) : null}
            {v.status === 'active' ? (
              <ConfirmAction
                action={setVendorStatus}
                fields={{ id: v.id, status: 'inactive' }}
                label="Make inactive"
                title={`Make ${v.code} inactive?`}
                confirmLabel="Make inactive"
                variant="ghost"
              >
                It is not offered on new PRs or POs until made active again.
              </ConfirmAction>
            ) : null}
            {v.status !== 'blacklisted' ? (
              <ConfirmAction
                action={setVendorStatus}
                fields={{ id: v.id, status: 'blacklisted' }}
                label="Blacklist"
                title={`Blacklist ${v.code}?`}
                confirmLabel="Blacklist"
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: 'Why it is blacklisted (kept on the vendor)' }}
              >
                It is never offered on a PR or PO, and its rate contracts stop being used.
              </ConfirmAction>
            ) : null}
          </div>
        ) : null}
      </section>

      {ch ? (
        <section className="ep-card" aria-labelledby="vd-ch" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="vd-ch" className="ep-card__title">
            Change waiting for approval
          </h2>
          <p style={{ marginTop: 0 }}>
            Asked by {ch.requestedBy ?? '—'} on {when(ch.requestedAt)}: {ch.reason}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="The change">
            <table className="ep-table" data-density="dense">
              <caption className="ep-sr-only">Now and after the change</caption>
              <thead>
                <tr>
                  <th scope="col">Detail</th>
                  <th scope="col">Now</th>
                  <th scope="col">After the change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">GSTIN</th>
                  <td>{ch.before.gstin ?? '—'}</td>
                  <td>{ch.changes.gstin ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">PAN</th>
                  <td>{ch.before.pan ?? '—'}</td>
                  <td>{ch.changes.pan ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Bank account</th>
                  <td>{ch.before.bankHint ?? '—'}</td>
                  <td>
                    {ch.changes.bank
                      ? `${ch.changes.bank.bankName} ${ch.changes.bank.accountNo} (${ch.changes.bank.ifsc}) · ${ch.changes.bank.holder}`
                      : (ch.changes.bankHint ?? 'No change')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            {canApprove ? (
              <>
                <ConfirmAction
                  action={decideVendorChange}
                  fields={{ id: ch.id, approve: '1', back }}
                  label="Approve the change"
                  title="Approve the change?"
                  confirmLabel="Approve"
                  variant="primary"
                >
                  Check the new details against the documents (a cancelled cheque for a bank
                  account). Once approved they are in force.
                </ConfirmAction>
                <ConfirmAction
                  action={decideVendorChange}
                  fields={{ id: ch.id, approve: '0', back }}
                  label="Reject the change"
                  title="Reject the change?"
                  confirmLabel="Reject"
                  variant="ghost"
                  confirmVariant="danger"
                  reason={{ label: 'Why it is rejected' }}
                >
                  The vendor keeps its present details.
                </ConfirmAction>
              </>
            ) : null}
            {canManage ? (
              <form action={withdrawVendorChange}>
                <input type="hidden" name="id" value={ch.id} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit" variant="ghost" size="sm">
                  Withdraw my change
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="vd-docs" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="vd-docs" className="ep-card__title">
          Documents
        </h2>
        {v.documents.length ? (
          <ul className="ep-purch-lines" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {v.documents.map((d) => (
              <li
                key={d.id}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <strong>{DOC_KIND[d.kind as keyof typeof DOC_KIND] ?? d.kind}</strong>
                <span className="ep-field__help">{when(d.uploadedAt)}</span>
                <FileLinks
                  href={`/api/files/${d.fileId}/download`}
                  label={DOC_KIND[d.kind as keyof typeof DOC_KIND] ?? d.kind}
                />
                {canManage ? (
                  <form action={removeVendorDocument}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="docId" value={d.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            No documents yet: the GST certificate, a cancelled cheque and the Udyam certificate help
            the approver.
          </p>
        )}
        {canManage ? (
          <form
            action={addVendorDocument}
            className="ep-grid__toolbar"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <input type="hidden" name="id" value={v.id} />
            <label className="ep-field" htmlFor="vd-kind">
              <span className="ep-field__label">Document</span>
              <select id="vd-kind" name="kind" className="ep-select">
                {Object.entries(DOC_KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="vd-file">
              <span className="ep-field__label">PDF or photo (up to 5 MB)</span>
              <input
                id="vd-file"
                name="file"
                type="file"
                className="ep-input"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                required
              />
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Upload
            </Button>
          </form>
        ) : null}
      </section>

      {lists ? (
        <section style={{ marginTop: 'var(--sp-5)' }} aria-label="Change the vendor">
          <VendorForm vendor={v} lists={lists} />
        </section>
      ) : null}
    </>
  );
}
