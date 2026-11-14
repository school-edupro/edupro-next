import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { copyCertificateTemplate } from '@/lib/certificate-setup-actions';
import {
  dmy,
  type CertificateSetupOverview,
  type CertificateTemplateRow,
} from '@/lib/certificates';

/** Certificate templates (docs/design/87, phase B): each layout, its version, the types that use it; a copy. */
export default async function CertificateTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage')) notFound();
  let o: CertificateSetupOverview;
  try {
    o = await apiFetch<CertificateSetupOverview>('/certificates/setup');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate set-up', href: '/certificates/setup' },
          { label: 'Templates' },
        ]}
      />
      <PageHeader
        kicker="Certificate set-up"
        title="Templates"
        description="Open a template to edit it with the field list and a live preview. Every save is a new version; certificates already issued keep the version they were made with."
      />
      <Notice params={sp} />
      <Card>
        <DataTable<CertificateTemplateRow>
          caption="Certificate templates"
          density="dense"
          columns={[
            {
              key: 'name',
              header: 'Template',
              render: (t) => (
                <a href={`/certificates/setup/templates/${t.id}`}>
                  <strong>{t.name}</strong>
                </a>
              ),
            },
            { key: 'used', header: 'Used by', render: (t) => t.usedBy.join(', ') || '—' },
            { key: 'v', header: 'Version', render: (t) => String(t.version) },
            { key: 'made', header: 'Certificates made', render: (t) => String(t.made) },
            { key: 'at', header: 'Last changed', render: (t) => dmy(t.updatedAt.slice(0, 10)) },
            {
              key: 'ready',
              header: '',
              render: (t) => (t.ready ? <Badge tone="info">Ready layout</Badge> : null),
            },
          ]}
          rows={o.templates}
          rowKey={(t) => t.id}
          emptyTitle="No templates"
        />
      </Card>
      <Card title="Copy a template">
        <form action={copyCertificateTemplate} className="ep-cert-fields">
          <SelectField
            id="cpOf"
            name="copyOf"
            label="Copy of"
            defaultValue={o.templates[0]?.id ?? ''}
            options={o.templates.map((t) => ({ value: t.id, label: t.name }))}
          />
          <label className="ep-field" htmlFor="cpName">
            <span className="ep-field__label">Name of the copy *</span>
            <input
              id="cpName"
              name="name"
              className="ep-input"
              required
              minLength={2}
              maxLength={120}
            />
          </label>
          <div>
            <Button type="submit" variant="secondary">
              Make the copy
            </Button>
          </div>
        </form>
        <p className="ep-field__help">
          A copy is a new layout: give it to a type as its template, or as another layout to choose
          at issue.
        </p>
      </Card>
    </>
  );
}
