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
  // the purchase view right, or a vendor approver named in the settings: the API decides
  const canManage = me.permissions.includes('purchase.master.manage');
  const v = await apiFetch<VendorDetail>(`/purchase/vendors/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  // the vendor approvers named in Purchase → Settings, else the right (the API says)
  const canApprove = v.canApprove === true;
  const lists = canManage ? await vendorFormLists() : null;
  const st = VENDOR_STATUS[v.status];
  const ch = v.pendingChange;
  const back = `/purchase/vendors/${v.id}`;
  const kinds = new Set(v.documents.map((d) => d.kind));
  const missing = [
    v.gstStatus !== 'unregistered' && !kinds.has('gst_certificate') ? 'GST certificate' : null,
    !kinds.has('pan_card') ? 'PAN card' : null,
    v.bankHint && !kinds.has('cancelled_cheque') ? 'cancelled cheque' : null,
    v.msmeType && !kinds.has('udyam_certificate') ? 'Udyam certificate' : null,
  ].filter((x): x is string => x !== null);
  const editOpen = sp.edit === '1';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase set-up', href: '/purchase' },
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
              You entered this vendor: another vendor approver approves it (Purchase → Settings →
              Vendor approval).
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
            <p className="ep-field__help">
              Waiting for a vendor approver (Purchase → Settings → Vendor approval).
            </p>
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

      <section className="ep-card" aria-labelledby="vd-det" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="vd-det" className="ep-card__title">
          Details
        </h2>
        <dl className="ep-facts">
          <div>
            <dt>Legal name</dt>
            <dd>
              {v.legalName}
              {v.tradeName ? ` · trading as ${v.tradeName}` : ''}
            </dd>
          </div>
          <div>
            <dt>Code · kind</dt>
            <dd>
              {v.code} · {VENDOR_KIND[v.kind]}
            </dd>
          </div>
          <div>
            <dt>GST</dt>
            <dd>
              {GST_STATUS[v.gstStatus]}
              {v.gstin ? ` · GSTIN ${v.gstin}` : ''}
              {v.stateCode ? ` · state code ${v.stateCode}` : ''}
            </dd>
          </div>
          <div>
            <dt>PAN</dt>
            <dd>{v.pan ?? '—'}</dd>
          </div>
          <div>
            <dt>MSME</dt>
            <dd>
              {v.msmeType
                ? `${v.msmeType[0]!.toUpperCase()}${v.msmeType.slice(1)}${v.udyamNo ? ` · ${v.udyamNo}` : ''}`
                : 'Not MSME / not known'}
            </dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>
              {[v.address, [v.city, v.pin].filter(Boolean).join(' '), v.state, v.country]
                .filter(Boolean)
                .join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt>Mobile · e-mail</dt>
            <dd>
              {v.phone ? <a href={`tel:${v.phone}`}>{v.phone}</a> : '—'}
              {' · '}
              {v.email ? <a href={`mailto:${v.email}`}>{v.email}</a> : '—'}
            </dd>
          </div>
          <div>
            <dt>Payment term</dt>
            <dd>{v.paymentTerm ?? 'The school’s default'}</dd>
          </div>
          <div>
            <dt>Supplies</dt>
            <dd>
              {v.categories?.length ? v.categories.map((c) => c.name).join(', ') : 'Any category'}
            </dd>
          </div>
          <div>
            <dt>Bank account</dt>
            <dd>
              {v.bank
                ? `${v.bank.bankName} · A/c ${v.bank.accountNo} · ${v.bank.ifsc} · ${v.bank.holder}`
                : (v.bankHint ?? 'Not given yet')}
            </dd>
          </div>
        </dl>
        {v.contacts.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Contacts"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <table className="ep-table" data-density="dense">
              <caption className="ep-sr-only">Contacts</caption>
              <thead>
                <tr>
                  <th scope="col">Contact</th>
                  <th scope="col">Role</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {v.contacts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name} {c.isMain ? <Badge tone="info">Main</Badge> : null}
                    </td>
                    <td>{c.role ?? '—'}</td>
                    <td>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '—'}</td>
                    <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          Documents · {v.documents.length}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          View opens a document in the browser; Download saves a copy. Anyone who sees the vendor
          may open them (each opening is recorded).
          {missing.length ? ` Not attached yet: ${missing.join(', ')}.` : ''}
        </p>
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
                <span className="ep-field__help">
                  {d.contentType === 'application/pdf' ? 'PDF' : 'Photo'} · added{' '}
                  {when(d.uploadedAt)}
                </span>
                <FileLinks
                  href={`/api/purchase/vendors/${v.id}/documents/${d.id}`}
                  label={`${DOC_KIND[d.kind as keyof typeof DOC_KIND] ?? d.kind} of ${v.legalName}`}
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
          <p className="ep-field__help" style={{ margin: 0 }}>
            No documents yet: the GST certificate, the PAN card, a cancelled cheque and the Udyam
            certificate help the approver check the vendor.
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
        <details className="ep-card" style={{ marginTop: 'var(--sp-5)' }} open={editOpen}>
          <summary className="ep-card__title" style={{ cursor: 'pointer' }}>
            Change the vendor
          </summary>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <VendorForm vendor={v} lists={lists} />
          </div>
        </details>
      ) : null}
    </>
  );
}
