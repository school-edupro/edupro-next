import { Breadcrumbs, Button, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { TemplateEditor } from '@/components/certificates/TemplateEditor';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  resetCertificateTemplate,
  restoreCertificateTemplate,
  saveCertificateTemplate,
} from '@/lib/certificate-setup-actions';
import { dmy, type CertificateTemplateDetail } from '@/lib/certificates';

type V = CertificateTemplateDetail['versions'][number];

/** One certificate template (docs/design/87, phase B): the editor, its versions, back to the ready layout. */
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
    ? `Saved as version ${sp.ok.slice(1)}.`
    : sp.ok === 'copied'
      ? 'Copy made.'
      : null;
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
        description={
          t.usedBy.length
            ? `Used by ${t.usedBy.map((u) => u.name).join(', ')} · version ${String(t.version)}`
            : `Not used by a type yet · version ${String(t.version)}`
        }
      />
      {saved ? (
        <div className="ep-alert ep-alert--success" role="status">
          {saved}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <SelectField
          id="forType"
          name="type"
          label="Show the fields and a sample of"
          defaultValue={t.forType ?? ''}
          options={t.types.map((x) => ({
            value: x.code,
            label: `${x.name}${x.audience === 'STAFF' ? ' (staff)' : ''}`,
          }))}
        />
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <TemplateEditor
        key={`${t.id}-${String(t.version)}-${t.forType ?? ''}`}
        t={t}
        action={saveCertificateTemplate}
      />
      <FoldCard id="tpl-versions" title="Versions" hint={`${String(t.versions.length)} saved`}>
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
              header: '',
              render: (v) =>
                v.version === t.version ? (
                  'In use'
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
      {t.ready ? (
        <FoldCard
          id="tpl-reset"
          title="Back to the ready layout"
          hint="EduPro's layout for this certificate"
        >
          <ConfirmAction
            action={resetCertificateTemplate}
            fields={{ id: t.id }}
            label="Back to the ready layout"
            title="Back to the ready layout"
            confirmLabel="Use the ready layout"
          >
            The ready layout becomes version {String(t.version + 1)}; the school&apos;s changes stay
            in the versions above.
          </ConfirmAction>
        </FoldCard>
      ) : null}
    </>
  );
}
