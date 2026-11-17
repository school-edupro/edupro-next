import { Badge, Breadcrumbs, Button, Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { DialogButton } from '@/components/leave/DialogButton';
import { Icon } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  issueCertificateImport,
  reuploadCertificateSheet,
  startImportWithdrawals,
  verifyCertificateImport,
} from '@/lib/certificate-import-actions';
import {
  FIELD_PREFIX,
  PERSON_PREFIX,
  dmy,
  type CertificateImport,
  type CertificateImportRow,
} from '@/lib/certificates';

type R = CertificateImportRow;
const TONE: Record<R['status'], 'success' | 'warning' | 'info' | 'neutral'> = {
  ready: 'info',
  attention: 'warning',
  issued: 'success',
  issuing: 'neutral',
};
const WORD: Record<R['status'], string> = {
  ready: 'Ready',
  attention: 'Needs attention',
  issued: 'Issued',
  issuing: 'Being issued',
};

/**
 * One upload of a certificate sheet (docs/design/87, 17 Nov 2026): the figures; what to do — issue the rows that are
 * ready, download what to fix and upload it again, check again, start the withdrawals a TC still needs; the runs it
 * issued (their PDFs and ZIP); and its rows, each ready, with what to fix, or with its certificate.
 */
export default async function CertificateImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.issue')) notFound();
  let u: CertificateImport;
  try {
    u = await apiFetch<CertificateImport>(`/certificates/imports/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const staff = u.type.audience === 'STAFF';
  const f = u.figures;
  const canWithdraw = me.permissions.includes('people.withdrawal.manage');
  const show = ['attention', 'ready', 'issued', 'all'].includes(sp.show ?? '')
    ? sp.show!
    : f.attention
      ? 'attention'
      : 'all';
  const rows = u.rows.filter((r) => show === 'all' || r.status === show);
  const today = new Date().toISOString().slice(0, 10);

  /** The Issue page with this row's details: its paper and checks, nothing issued. */
  const seeHref = (r: R) => {
    const q = new URLSearchParams({ type: u.type.code });
    q.set(staff ? 'employee' : 'student', r.personId ?? '');
    for (const [k, v] of Object.entries(r.issue.fields)) q.set(`${FIELD_PREFIX}${k}`, String(v));
    for (const [k, v] of Object.entries(r.issue.person)) q.set(`${PERSON_PREFIX}${k}`, v);
    if (r.issue.purpose) q.set('purpose', r.issue.purpose);
    if (r.issue.issuedOn) q.set('issuedOn', r.issue.issuedOn);
    if (r.issue.variant) q.set('variant', r.issue.variant);
    return `/certificates/issue?${q.toString()}`;
  };
  const tab = (key: string, label: string, n: number) => (
    <a
      key={key}
      href={`/certificates/imports/${u.id}?show=${key}`}
      className={`ep-btn ep-btn--sm ${show === key ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
      aria-current={show === key ? 'page' : undefined}
    >
      {label} ({String(n)})
    </a>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Bulk issue', href: '/certificates/bulk' },
          { label: 'From Excel', href: '/certificates/imports' },
          { label: u.title },
        ]}
      />
      <PageHeader
        kicker={`${u.type.name} · from Excel`}
        title={u.title}
        description={`${u.fileName ?? 'Sheet'} · uploaded ${u.uploads > 1 ? `${String(u.uploads)} times` : 'once'}${u.by ? ` · by ${u.by}` : ''} · ${dmy(u.createdAt.slice(0, 10))}. Each row is checked as the Issue page checks it; the rows that are ready are issued together, the others stay here with what to fix.`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Rows" value={String(f.rows)} />
        <KpiTile label="Ready to issue" value={String(f.ready)} />
        <KpiTile label="Need attention" value={String(f.attention)} />
        <KpiTile label="Issued" value={String(f.issued)} />
        <KpiTile label="Withdrawal not started" value={String(f.startWithdrawal)} />
        <KpiTile label="Uploads" value={String(u.uploads)} />
      </div>

      <Card title="What to do">
        <div className="ep-ctype__actions" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {f.ready ? (
            <ConfirmAction
              action={issueCertificateImport}
              fields={{ id: u.id }}
              label={`Issue the ${String(f.ready)} ready`}
              title={`Issue ${String(f.ready)} ${u.type.name.toLowerCase()}${f.ready === 1 ? '' : 's'}`}
              confirmLabel="Issue them"
              variant="primary"
            >
              Each gets the next number of the register and its own details from the sheet; a PDF is
              made for each {staff ? 'department' : 'section'}.
              {f.attention ? ` The ${String(f.attention)} needing attention stay here to fix.` : ''}{' '}
              A row whose checks changed since is left out with why.
            </ConfirmAction>
          ) : null}
          {f.attention ? (
            <a className="ep-btn ep-btn--secondary" href={`/certificates/imports/${u.id}/errors`}>
              <Icon name="download" size={16} /> Download what to fix
            </a>
          ) : null}
          <DialogButton
            id="reupload"
            className="ep-btn ep-btn--secondary"
            label={
              <>
                <Icon name="upload" size={16} /> Upload a corrected sheet
              </>
            }
            title="Upload a corrected sheet"
          >
            <form action={reuploadCertificateSheet} className="ep-cert-fields">
              <input type="hidden" name="id" value={u.id} />
              <label className="ep-field" htmlFor="reFile" style={{ gridColumn: '1 / -1' }}>
                <span className="ep-field__label">The corrected sheet *</span>
                <input
                  id="reFile"
                  name="file"
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="ep-input"
                  required
                />
                <span className="ep-field__help">
                  Its rows take the place of the same {staff ? 'employees' : 'students'} here (those
                  issued stay issued); rows not in it stay as they are. Then every row is checked
                  again.
                </span>
              </label>
              <div>
                <Button type="submit">Upload and check</Button>
              </div>
            </form>
          </DialogButton>
          <form action={verifyCertificateImport}>
            <input type="hidden" name="id" value={u.id} />
            <Button type="submit" variant="ghost">
              Check again
            </Button>
          </form>
        </div>
        {f.startWithdrawal ? (
          <div
            className="ep-alert ep-alert--info"
            role="status"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <div>
              <p style={{ margin: 0 }}>
                <strong>
                  {String(f.startWithdrawal)} student{f.startWithdrawal === 1 ? ' has' : 's have'}{' '}
                  no withdrawal yet.
                </strong>{' '}
                A TC is issued once the withdrawal is complete: its departments clear the fees,
                library, hostel and transport, then press Check again.
              </p>
              {canWithdraw ? (
                <div style={{ marginTop: 'var(--sp-2)' }}>
                  <DialogButton
                    id="withdrawals"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    label={`Start the withdrawals for ${String(f.startWithdrawal)}`}
                    title={`Start the withdrawals for ${String(f.startWithdrawal)}`}
                  >
                    <form action={startImportWithdrawals} className="ep-cert-fields">
                      <input type="hidden" name="id" value={u.id} />
                      <label className="ep-field" htmlFor="wdOn">
                        <span className="ep-field__label">Leaving date *</span>
                        <input
                          id="wdOn"
                          name="leavingOn"
                          type="date"
                          className="ep-input"
                          defaultValue={today}
                          required
                        />
                      </label>
                      <label className="ep-field" htmlFor="wdWhy">
                        <span className="ep-field__label">Reason *</span>
                        <input
                          id="wdWhy"
                          name="reason"
                          className="ep-input"
                          defaultValue="Passed out"
                          maxLength={300}
                          required
                        />
                      </label>
                      <p className="ep-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
                        As People → Withdrawals → Bulk: one leaving date and reason for all of them;
                        each department is asked to clear them.
                      </p>
                      <div>
                        <Button type="submit">Start the withdrawals</Button>
                      </div>
                    </form>
                  </DialogButton>
                </div>
              ) : (
                <p style={{ margin: 'var(--sp-2) 0 0' }}>
                  Starting them needs the withdrawal right: ask the office that runs withdrawals
                  (People → Withdrawals).
                </p>
              )}
            </div>
          </div>
        ) : null}
        {u.runIds.length ? (
          <p className="ep-field__help" style={{ margin: 'var(--sp-3) 0 0' }}>
            Issued from here:{' '}
            {u.runIds.map((r, i) => (
              <span key={r}>
                {i ? ' · ' : ''}
                <a href={`/certificates/runs/${r}`}>run {String(i + 1)} — its PDFs and ZIP</a>
              </span>
            ))}
          </p>
        ) : null}
      </Card>

      <Card title="Rows">
        <nav
          aria-label="Show"
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          {tab('attention', 'Need attention', f.attention)}
          {tab('ready', 'Ready', f.ready)}
          {tab('issued', 'Issued', f.issued)}
          {tab('all', 'All', f.rows)}
        </nav>
        <DataTable<R>
          caption="Rows of the sheet"
          density="dense"
          columns={[
            {
              key: 'row',
              header: 'Row',
              render: (r) =>
                `${String(r.row)}${u.uploads > 1 ? ` (upload ${String(r.upload)})` : ''}`,
            },
            {
              key: 'who',
              header: staff ? 'Employee' : 'Student',
              render: (r) => (
                <>
                  <strong>{r.name || '—'}</strong>
                  <span className="ep-ctype__num">
                    {r.key || '—'}
                    {r.groupLabel ? ` · ${r.groupLabel}` : ''}
                  </span>
                </>
              ),
            },
            {
              key: 'status',
              header: 'State',
              render: (r) => <Badge tone={TONE[r.status]}>{WORD[r.status]}</Badge>,
            },
            {
              key: 'what',
              header: 'What to fix, or the certificate',
              render: (r) =>
                r.status === 'issued' && r.certificateId ? (
                  <a href={`/certificates/${r.certificateId}`}>{r.number ?? 'Open it'}</a>
                ) : r.problems.length ? (
                  <ul className="ep-cert-checks" style={{ margin: 0 }}>
                    {r.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  'Ready to issue'
                ),
            },
            {
              key: 'act',
              header: 'Actions',
              render: (r) =>
                r.personId && r.status !== 'issued' ? (
                  <a className="ep-btn ep-btn--ghost ep-btn--sm" href={seeHref(r)}>
                    <Icon name="eye" size={16} /> See the paper
                    <span className="ep-sr-only"> of {r.name}</span>
                  </a>
                ) : null,
            },
          ]}
          rows={rows}
          rowKey={(r) => `${String(r.upload)}-${String(r.row)}-${r.key}`}
          emptyTitle={show === 'attention' ? 'No row needs attention' : 'No rows here'}
        />
      </Card>
    </>
  );
}
