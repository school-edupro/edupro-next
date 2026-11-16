import { Badge, Breadcrumbs, Button, DataTable, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { DialogButton } from '@/components/leave/DialogButton';
import { Icon } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { TemplateEditor } from '@/components/certificates/TemplateEditor';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  copyCertificateTemplate,
  resetCertificateTemplate,
  restoreCertificateTemplate,
  saveCertificateTemplate,
} from '@/lib/certificate-setup-actions';
import { dmy, type CertificateTemplateDetail } from '@/lib/certificates';

type V = CertificateTemplateDetail['versions'][number];

/**
 * One certificate template (docs/design/87; rebuilt 16 Nov 2026): who uses it, Make a copy and Back to the ready layout
 * at the top; the editor with the paper as it prints in view; the versions folded below.
 */
export default async function CertificateTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage') || !/^\d{1,18}$/.test(id)) notFound();
  const type = sp.type && /^[A-Z][A-Z0-9_]{1,19}$/.test(sp.type) ? sp.type : '';
  let t: CertificateTemplateDetail;
  try {
    t = await apiFetch<CertificateTemplateDetail>(
      `/certificates/setup/templates/${id}${type ? `?type=${type}` : ''}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const saved = sp.ok?.startsWith('v')
    ? `Saved as version ${sp.ok.slice(1)}. The next certificates print with it.`
    : sp.ok === 'copied'
      ? 'Copy made. Change it here, then give it to a certificate type under Layout on the type’s page.'
      : null;
  const origin =
    t.code === 'cert_legacy'
      ? 'Prints the certificates brought from the old system'
      : !t.ready
        ? "The school's copy"
        : t.version > 1
          ? "EduPro's layout, changed by the school"
          : "EduPro's ready layout";
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate set-up', href: '/certificates/setup' },
          { label: 'Templates', href: '/certificates/setup/templates' },
          { label: t.name },
        ]}
      />
      <PageHeader
        kicker="Certificate template"
        title={t.name}
        description={`${origin} · version ${String(t.version)} in use`}
        actions={
          <>
            <DialogButton
              id="tpl-copy"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              label={
                <>
                  <Icon name="copy" size={16} /> Make a copy
                </>
              }
              title={`Make a copy of ${t.name}`}
            >
              <form action={copyCertificateTemplate} className="ep-cert-fields">
                <input type="hidden" name="copyOf" value={t.id} />
                <label className="ep-field" htmlFor="cpName" style={{ gridColumn: '1 / -1' }}>
                  <span className="ep-field__label">Name of the copy *</span>
                  <input
                    id="cpName"
                    name="name"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={`${t.name} (copy)`}
                  />
                  <span className="ep-field__help">
                    The copy is made from the saved layout (not from changes not saved yet).
                  </span>
                </label>
                <div>
                  <Button type="submit">Make the copy</Button>
                </div>
              </form>
            </DialogButton>
            {t.ready ? (
              <ConfirmAction
                action={resetCertificateTemplate}
                fields={{ id: t.id }}
                label="Back to the ready layout"
                title="Back to the ready layout"
                confirmLabel="Use the ready layout"
                variant="ghost"
              >
                EduPro&apos;s ready layout becomes version {String(t.version + 1)}. The
                school&apos;s changes stay under Versions, to use again.
              </ConfirmAction>
            ) : null}
          </>
        }
      />
      {saved ? (
        <div className="ep-alert ep-alert--success" role="status">
          {saved}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <p className="ep-ctpl__usedby">
        <span className="ep-field__label">Used by</span>{' '}
        {t.usedBy.length ? (
          t.usedBy.map((u) => (
            <a key={u.code} className="ep-ctpl__chip" href={`/certificates/setup/types/${u.code}`}>
              {u.name}
            </a>
          ))
        ) : (
          <Badge tone="neutral">No certificate type</Badge>
        )}
      </p>
      <TemplateEditor
        key={`${t.id}-${String(t.version)}-${t.forType ?? ''}`}
        t={t}
        action={saveCertificateTemplate}
      />
      <FoldCard
        id="tpl-versions"
        title="Versions"
        hint={`${String(t.versions.length)} saved · version ${String(t.version)} in use`}
      >
        <DataTable<V>
          caption="Versions of the template"
          density="dense"
          columns={[
            { key: 'v', header: 'Version', render: (v) => String(v.version) },
            { key: 'at', header: 'Saved on', render: (v) => dmy(v.at.slice(0, 10)) },
            { key: 'by', header: 'By', render: (v) => v.by ?? '—' },
            { key: 'made', header: 'Certificates made with it', render: (v) => String(v.made) },
            {
              key: 'act',
              header: 'Use',
              render: (v) =>
                v.version === t.version ? (
                  <Badge tone="success">In use</Badge>
                ) : (
                  <ConfirmAction
                    action={restoreCertificateTemplate}
                    fields={{ id: t.id, version: String(v.version) }}
                    label={`Use version ${String(v.version)} again`}
                    title={`Use version ${String(v.version)} again`}
                    confirmLabel="Use it again"
                    variant="ghost"
                  >
                    Version {String(v.version)} becomes version {String(t.version + 1)}.
                    Certificates already issued keep theirs.
                  </ConfirmAction>
                ),
            },
          ]}
          rows={t.versions}
          rowKey={(v) => String(v.version)}
          emptyTitle="No versions"
        />
      </FoldCard>
    </>
  );
}
