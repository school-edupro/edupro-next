import { Badge, Breadcrumbs, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { closeCertificateRequestFee, decideCertificateRequest } from '@/lib/certificate-actions';
import { CHANNEL, STAGE, dmy, type CertificateRequestDetail } from '@/lib/certificates';

type L = CertificateRequestDetail['levels'][number];
const OK: Record<string, string> = {
  approved: 'Approved.',
  rejected: 'Not approved: the requester is told in the app.',
  waived: 'Fee taken off: ready to issue.',
  refused: 'Turned down: the requester is told in the app.',
};

/**
 * One certificate request (docs/design/87, phase C): who asked, for whom and why; the checks as they stood; the
 * approval levels; the fee; then approve or reject (at my level), take the fee off, issue it, or turn it down.
 */
export default async function CertificateRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let r: CertificateRequestDetail;
  try {
    r = await apiFetch<CertificateRequestDetail>(`/certificate-requests/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const failed = r.checks.filter((c) => !c.ok);
  const issueHref = `/certificates/issue?${new URLSearchParams({
    type: r.typeCode,
    ...(r.studentId ? { student: r.studentId } : { employee: r.employeeId ?? '' }),
    request: r.id,
    ...(r.purpose ? { purpose: r.purpose } : {}),
  }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Requests', href: '/certificates/requests' },
          { label: `${r.typeName} · ${r.person}` },
        ]}
      />
      <PageHeader
        kicker="Certificate request"
        title={`${r.typeName} for ${r.person}`}
        description={`${r.personNo}${r.classLabel ? ` · ${r.classLabel}` : ''} · asked by ${r.requestedBy ?? '—'} (${CHANNEL[r.channel]}) on ${dmy(r.createdAt.slice(0, 10))}`}
        actions={
          r.can.issue ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href={issueHref}>
              Issue it
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
        <KpiTile label="Stage" value={STAGE[r.stage].label} />
        <KpiTile label="Copies" value={String(r.copies)} />
        <KpiTile
          label="Days open"
          value={['waiting', 'fee', 'ready'].includes(r.stage) ? String(r.ageDays) : '—'}
        />
        <KpiTile label="Fee" value={r.fee ? `₹${r.fee.toFixed(2)}` : 'None'} />
        <KpiTile
          label="Fee paid"
          value={r.fee ? (r.feePaid ? 'Yes' : r.feeWaived ? 'Waived' : 'Not yet') : '—'}
        />
        <KpiTile label="Checks not clear" value={String(failed.length)} />
      </div>
      <section className="ep-card" aria-labelledby="rq-main">
        <h2 id="rq-main" className="ep-card__title">
          The request
        </h2>
        <dl className="ep-cert-dl">
          <dt>Purpose</dt>
          <dd>{r.purpose ?? '—'}</dd>
          {r.note ? (
            <>
              <dt>Note</dt>
              <dd>{r.note}</dd>
            </>
          ) : null}
          <dt>Stage</dt>
          <dd>
            <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge>
            {r.waitingWith ? ` · with ${r.waitingWith}` : ''}
          </dd>
          {r.decisionNote ? (
            <>
              <dt>Decision</dt>
              <dd>
                {r.decisionNote}
                {r.decidedBy ? ` · ${r.decidedBy}` : ''}
              </dd>
            </>
          ) : null}
          {r.feeWaived ? (
            <>
              <dt>Fee waived</dt>
              <dd>{r.feeWaived}</dd>
            </>
          ) : null}
          {r.certificateIds.length ? (
            <>
              <dt>Issued</dt>
              <dd>
                {r.certificateIds.map((c) => (
                  <a key={c} href={`/certificates/${c}`} style={{ marginRight: 'var(--sp-2)' }}>
                    Open the certificate
                  </a>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
        {(r.can.decide || r.can.waive || r.can.reject) && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            {r.can.decide ? (
              <>
                <ConfirmAction
                  action={decideCertificateRequest}
                  fields={{ id: r.id, decision: 'approve' }}
                  label="Approve"
                  title={`Approve the ${r.typeName.toLowerCase()}`}
                  confirmLabel="Approve"
                  variant="primary"
                  reason={{ label: 'A note (optional)', optional: true }}
                >
                  It moves to the next level{r.fee ? ', or waits for the fee' : ''}, or is ready to
                  issue.
                </ConfirmAction>
                <ConfirmAction
                  action={decideCertificateRequest}
                  fields={{ id: r.id, decision: 'reject' }}
                  label="Reject"
                  title={`Reject the ${r.typeName.toLowerCase()}`}
                  confirmLabel="Reject"
                  confirmVariant="danger"
                  variant="ghost"
                  reason={{ label: 'Why (the requester sees it)' }}
                >
                  The requester is told in the app.
                </ConfirmAction>
              </>
            ) : null}
            {r.can.waive ? (
              <ConfirmAction
                action={closeCertificateRequestFee}
                fields={{ id: r.id, what: 'waive' }}
                label="Take the fee off"
                title="Take the fee off"
                confirmLabel="Take it off"
                variant="secondary"
                reason={{ label: 'Why' }}
              >
                The unpaid certificate fee is cancelled and the request is ready to issue.
              </ConfirmAction>
            ) : null}
            {r.can.reject ? (
              <ConfirmAction
                action={closeCertificateRequestFee}
                fields={{ id: r.id, what: 'refuse' }}
                label="Turn it down"
                title="Turn the request down"
                confirmLabel="Turn it down"
                confirmVariant="danger"
                variant="ghost"
                reason={{ label: 'Why (the requester sees it)' }}
              >
                An unpaid fee is cancelled; the requester is told in the app.
              </ConfirmAction>
            ) : null}
          </div>
        )}
      </section>
      <FoldCard
        id="rq-checks"
        title="Checks when asked"
        hint={failed.length ? `${String(failed.length)} not clear` : 'All clear'}
        open={failed.length > 0}
      >
        <ul className="ep-cert-checks">
          {r.checks.map((c) => (
            <li key={c.key}>
              <Badge tone={c.ok ? 'success' : 'danger'}>{c.ok ? 'Clear' : 'Not clear'}</Badge>{' '}
              <strong>{c.label}</strong>: {c.detail}
            </li>
          ))}
        </ul>
        <p className="ep-field__help">The issue checks again (fees too).</p>
      </FoldCard>
      <FoldCard
        id="rq-levels"
        title="Approval levels"
        hint={r.levels.length ? `${String(r.levels.length)} level(s)` : 'None: approved when asked'}
      >
        <DataTable<L>
          caption="Approval levels"
          density="dense"
          columns={[
            { key: 'n', header: 'Level', render: (l) => `${String(l.level)}. ${l.name}` },
            { key: 'who', header: 'Who', render: (l) => l.assignees.join(', ') || '—' },
            {
              key: 's',
              header: 'Status',
              render: (l) => (
                <Badge
                  tone={
                    l.status === 'approved'
                      ? 'success'
                      : l.status === 'rejected'
                        ? 'danger'
                        : l.status === 'pending'
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {l.status}
                </Badge>
              ),
            },
            {
              key: 'by',
              header: 'By',
              render: (l) =>
                l.actedBy
                  ? `${l.actedBy}${l.actedAt ? ` · ${dmy(l.actedAt.slice(0, 10))}` : ''}`
                  : '',
            },
            { key: 'note', header: 'Note', render: (l) => l.note ?? '' },
          ]}
          rows={r.levels}
          rowKey={(l) => String(l.level)}
          emptyTitle="No levels"
        />
      </FoldCard>
    </>
  );
}
