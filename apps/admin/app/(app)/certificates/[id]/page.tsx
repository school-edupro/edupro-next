import { Badge, Breadcrumbs, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { ExportWatcher } from '@/components/ExportWatcher';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  cancelCertificate,
  duplicateCertificate,
  reissueCertificate,
  renderCertificate,
} from '@/lib/certificate-actions';
import { dmy, type Certificate, type CertificateDetail } from '@/lib/certificates';

const OK: Record<string, string> = {
  issued: 'Issued. The PDF is being made.',
  duplicated: 'Duplicate made. Its PDF is being made.',
  cancelled: 'Cancelled. Its number will not be given again.',
  rendered: 'The PDF is being made again.',
  reissued:
    "Re-issued with today's settings: it prints the signatory, layout and school details as they are now. The earlier certificate is cancelled; its number is never given again.",
};

/** The printed fields, as label → value rows, from the frozen data (nested objects one level down). */
function printed(
  data: Record<string, unknown>,
): Array<{ group: string; key: string; value: string }> {
  const GROUPS: Record<string, string> = {
    student: 'Student',
    employee: 'Employee',
    tc: 'Transfer certificate',
    fields: 'Fields typed at issue',
    attendance: 'Attendance',
    school: 'School',
  };
  const out: Array<{ group: string; key: string; value: string }> = [];
  for (const [g, label] of Object.entries(GROUPS)) {
    const o = data[g];
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '' || typeof v === 'object' || k === 'id')
        continue;
      out.push({ group: label, key: k.replace(/([A-Z])/g, ' $1').toLowerCase(), value: String(v) });
    }
  }
  return out;
}

/**
 * One certificate (docs/design/87): the number, copy and status first; the student, purpose, the PDF and the checks as
 * they stood; then its copies, what it printed, and the duplicate and cancel actions folded below.
 */
export default async function CertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let x: CertificateDetail;
  try {
    x = await apiFetch<CertificateDetail>(`/certificates/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  // the public checks of it (docs/design/87, phase D)
  const checks = await apiFetch<{
    total: number;
    rows: Array<{ at: string; method: string; result: string; repeat: boolean }>;
  }>(`/certificates/${id}/verifications`).catch(() => ({ total: 0, rows: [] }));
  const qrUrl = (x.data.qr as { url?: string } | undefined)?.url ?? null;
  const label = `${x.typeName} ${x.number}${x.copyNo ? ` duplicate ${String(x.copyNo)}` : ''}`;
  const failed = x.checks.filter((c) => !c.ok);
  const rows = printed(x.data);
  // the PDF: still being made by the workers (followed here), or to open — kept, or made again when it was cleared
  const exportStatus = x.exportId
    ? await apiFetch<{ export: { status: string } }>(`/reports/exports/${x.exportId}`)
        .then((r) => r.export.status)
        .catch(() => null)
    : null;
  const making = exportStatus === 'queued' || exportStatus === 'running';
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: x.number }]}
      />
      <PageHeader
        kicker={x.typeName}
        title={x.number}
        description={
          x.studentName
            ? `${x.studentName} · ${x.admissionNo ?? ''}${x.className ? ` · ${x.className}` : ''}`
            : undefined
        }
        actions={
          x.can.issue ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/certificates/issue">
              Issue another
            </a>
          ) : null
        }
      />
      {sp.ok && OK[sp.ok] ? (
        <div className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok]}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-dash-kpis">
        <KpiTile label="Status" value={x.status === 'issued' ? 'Issued' : 'Cancelled'} />
        <KpiTile label="Copy" value={x.copyNo ? `Duplicate ${String(x.copyNo)}` : 'Original'} />
        <KpiTile label="Issued on" value={dmy(x.issuedOn)} />
        <KpiTile
          label="Book / Sl. no."
          value={x.bookNo ? `${String(x.bookNo)} / ${String(x.slNo ?? '')}` : '—'}
        />
        <KpiTile label="Copies made" value={String(x.copies.length - 1)} />
        <KpiTile label="Checks not clear" value={String(failed.length)} />
      </div>
      <section className="ep-card" aria-labelledby="cert-main">
        <h2 id="cert-main" className="ep-card__title">
          The certificate
        </h2>
        <dl className="ep-cert-dl">
          <dt>{x.employeeId ? 'Employee' : 'Student'}</dt>
          <dd>
            {x.studentId || x.employeeId ? (
              <a
                href={
                  x.studentId
                    ? `/people/students/${x.studentId}`
                    : `/people/employees/${x.employeeId ?? ''}`
                }
              >
                {x.studentName} · {x.admissionNo}
              </a>
            ) : (
              '—'
            )}
          </dd>
          {x.purpose ? (
            <>
              <dt>Purpose</dt>
              <dd>{x.purpose}</dd>
            </>
          ) : null}
          <dt>Issued by</dt>
          <dd>{x.issuedBy ?? '—'}</dd>
          <dt>Template</dt>
          <dd>
            {x.template
              ? `${x.template.name}${x.template.version ? ` (version ${String(x.template.version)})` : ''}`
              : x.legacy
                ? 'From the old system'
                : 'The TC template of the time'}
          </dd>
          {x.transferCertificateId ? (
            <>
              <dt>TC</dt>
              <dd>
                <a href={`/people/tc?q=${encodeURIComponent(x.number)}`}>In the TC list</a>
              </dd>
            </>
          ) : null}
          {x.reissueOf ? (
            <>
              <dt>Re-issue of</dt>
              <dd>
                <a href={`/certificates/${x.reissueOf.id}`}>{x.reissueOf.number}</a> (cancelled),
                printed with the settings of its own day
              </dd>
            </>
          ) : null}
          {x.reissuedAs ? (
            <>
              <dt>Re-issued as</dt>
              <dd>
                <a href={`/certificates/${x.reissuedAs.id}`}>{x.reissuedAs.number}</a>, with the
                settings of its day
              </dd>
            </>
          ) : null}
          {x.status === 'cancelled' ? (
            <>
              <dt>Cancelled</dt>
              <dd>
                {x.cancelReason} · {x.cancelledBy ?? ''}{' '}
                {x.cancelledAt ? dmy(x.cancelledAt.slice(0, 10)) : ''}
              </dd>
            </>
          ) : null}
          <dt>Check link</dt>
          <dd>
            {qrUrl ? (
              <a href={qrUrl} target="_blank" rel="noopener noreferrer">
                The public check of this certificate
              </a>
            ) : (
              'Printed as a QR from its next PDF'
            )}
          </dd>
          <dt>PDF</dt>
          <dd>
            {x.exportId && making ? (
              <ExportWatcher
                id={x.exportId}
                format="pdf"
                labels={{
                  queued: 'PDF requested',
                  ready: 'Open',
                  pending: 'Making the PDF…',
                  failed: 'The PDF could not be made',
                  stuck:
                    'Still waiting: the workers service makes the PDFs; check that it is running.',
                }}
              />
            ) : (
              <FileLinks href={`/certificates/${x.id}/pdf`} label={label} />
            )}{' '}
            {x.status === 'issued' ? (
              <form action={renderCertificate} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={x.id} />
                <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                  {x.exportId ? 'Make it again' : 'Make the PDF'}
                </button>
              </form>
            ) : null}
          </dd>
        </dl>
        {x.overrideReason ? (
          <div className="ep-alert ep-alert--warning" role="status">
            Issued past a failed check by {x.overrideBy ?? 'the principal'}: {x.overrideReason}
          </div>
        ) : null}
      </section>
      <FoldCard
        id="cert-checks"
        title="Checks at issue"
        hint={failed.length ? `${String(failed.length)} not clear` : 'All clear'}
        open={failed.length > 0}
      >
        {x.checks.length ? (
          <ul className="ep-cert-checks">
            {x.checks.map((c) => (
              <li key={c.key}>
                <Badge tone={c.ok ? 'success' : 'danger'}>{c.ok ? 'Clear' : 'Not clear'}</Badge>{' '}
                <strong>{c.label}</strong>: {c.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">Made before the register recorded its checks.</p>
        )}
      </FoldCard>
      <FoldCard
        id="cert-verify"
        title="Public checks"
        hint={checks.total ? `Checked ${String(checks.total)} time(s)` : 'Not checked yet'}
      >
        {checks.rows.length ? (
          <ul className="ep-cert-checks">
            {checks.rows.map((v) => (
              <li key={v.at}>
                {dmy(v.at.slice(0, 10))} {v.at.slice(11, 16)} UTC ·{' '}
                {v.method === 'qr' ? 'by its QR' : 'by number and date'} ·{' '}
                <Badge tone={v.result === 'valid' ? 'success' : 'danger'}>
                  {v.result === 'valid' ? 'Valid' : 'Cancelled'}
                </Badge>
                {v.repeat ? ' · the same device again' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">Nobody has checked it on the public page yet.</p>
        )}
      </FoldCard>
      <FoldCard
        id="cert-copies"
        title="Original and duplicates"
        hint={`${String(x.copies.length)} in all`}
      >
        <DataTable<Certificate>
          caption="Original and duplicates"
          density="dense"
          columns={[
            {
              key: 'copy',
              header: 'Copy',
              render: (c) =>
                c.id === x.id ? (
                  <strong>{c.copyNo ? `Duplicate ${String(c.copyNo)}` : 'Original'}</strong>
                ) : (
                  <a href={`/certificates/${c.id}`}>
                    {c.copyNo ? `Duplicate ${String(c.copyNo)}` : 'Original'}
                  </a>
                ),
            },
            { key: 'on', header: 'Made on', render: (c) => dmy(c.issuedOn) },
            { key: 'by', header: 'By', render: (c) => c.issuedBy ?? '' },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <Badge tone={c.status === 'issued' ? 'success' : 'danger'}>
                  {c.status === 'issued' ? 'Issued' : 'Cancelled'}
                </Badge>
              ),
            },
            {
              key: 'pdf',
              header: 'PDF',
              render: (c) => (
                <FileLinks
                  href={`/certificates/${c.id}/pdf`}
                  label={`${c.number}${c.copyNo ? ` duplicate ${String(c.copyNo)}` : ''}`}
                />
              ),
            },
          ]}
          rows={x.copies}
          rowKey={(c) => c.id}
          emptyTitle="No copies"
        />
      </FoldCard>
      <FoldCard
        id="cert-printed"
        title="What it printed"
        hint="Frozen at issue: a later change does not alter it"
      >
        {rows.length ? (
          <dl className="ep-cert-dl">
            {rows.map((r) => (
              <div key={`${r.group}-${r.key}`} style={{ display: 'contents' }}>
                <dt>
                  {r.group}: {r.key}
                </dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="ep-field__help">Nothing recorded.</p>
        )}
      </FoldCard>
      {x.status === 'issued' && (x.can.issue || x.can.cancel) ? (
        <FoldCard
          id="cert-actions"
          title="Duplicate, re-issue or cancel"
          hint="A lost original, one to print with today's settings, or one issued in error"
          open={sp.open === 'actions'}
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A duplicate keeps the number and paper and prints DUPLICATE. A re-issue makes it again
            with a new number, printed with today&apos;s settings (signatory, layout, school
            details), and cancels this one. Cancelling takes its duplicates with it
            {x.transferCertificateId ? ' and cancels the TC' : ''}; the number is never given again.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {x.can.issue && x.can.cancel && !x.copyNo && !x.reissuedAs ? (
              <ConfirmAction
                action={reissueCertificate}
                fields={{ id: x.id }}
                label="Re-issue with today's settings"
                title={`Re-issue ${x.number} with today's settings`}
                confirmLabel="Re-issue it"
                variant="secondary"
                reason={{
                  label: 'Why it is re-issued',
                  placeholder: 'e.g. issued before the signatory was set',
                }}
              >
                A new certificate with a new number for the same{' '}
                {x.employeeId ? 'employee' : 'student'}, purpose and details, printed with the
                signatory, layout and school details as they are now — after the type&apos;s checks.{' '}
                {x.number}
                {x.copies.length > 1 ? ' and its duplicates are' : ' is'} cancelled in the same
                step.
                {x.overrideReason
                  ? " It was issued past a failed check: if that check still fails, the principal's reason carries over (the principal's right and a fresh sign-in are needed)."
                  : ''}
              </ConfirmAction>
            ) : null}
            {x.can.issue ? (
              <ConfirmAction
                action={duplicateCertificate}
                fields={{ id: x.id }}
                label="Print a duplicate"
                title={`Duplicate of ${x.number}`}
                confirmLabel="Make the duplicate"
                reason={{ label: 'Why a duplicate', placeholder: 'e.g. original lost' }}
              >
                The same paper with the same number, printed DUPLICATE (copy{' '}
                {String(Math.max(...x.copies.map((c) => c.copyNo)) + 1)}).
              </ConfirmAction>
            ) : null}
            {x.can.cancel ? (
              <ConfirmAction
                action={cancelCertificate}
                fields={{ id: x.id }}
                label="Cancel"
                title={`Cancel ${x.number}`}
                confirmLabel="Cancel the certificate"
                confirmVariant="danger"
                variant="ghost"
                reason={{ label: 'Why it is cancelled', placeholder: 'e.g. issued in error' }}
              >
                {x.copyNo
                  ? 'This duplicate is cancelled; the original stays.'
                  : `The certificate${x.copies.length > 1 ? ' and its duplicates' : ''} will show as cancelled.`}
              </ConfirmAction>
            ) : null}
          </div>
        </FoldCard>
      ) : null}
      {x.status === 'cancelled' && x.can.issue && !x.copyNo && !x.reissuedAs ? (
        <FoldCard
          id="cert-again"
          title="Issue again with today's settings"
          hint="A new certificate for the same person, purpose and details"
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A new certificate with a new number, printed with the signatory, layout and school
            details as they are now, after the type&apos;s checks. This one stays cancelled and
            points to it.
          </p>
          <ConfirmAction
            action={reissueCertificate}
            fields={{ id: x.id }}
            label="Issue again with today's settings"
            title={`Issue ${x.number} again with today's settings`}
            confirmLabel="Issue it"
            variant="secondary"
            reason={{ label: 'Why it is issued again', placeholder: 'e.g. cancelled in error' }}
          >
            The same type, {x.employeeId ? 'employee' : 'student'}, purpose and details; a new
            number.
          </ConfirmAction>
        </FoldCard>
      ) : null}
    </>
  );
}
