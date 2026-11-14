import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { createCertificateType } from '@/lib/certificate-setup-actions';
import type { CertificateSetupOverview } from '@/lib/certificates';

type T = CertificateSetupOverview['types'][number];
const STATE: Record<string, string> = {
  active: 'On the rolls',
  leaving: 'Leaving / left',
  any: 'Any',
};

/** What a type checks, in a few words. */
const checksOf = (t: T) =>
  [
    STATE[t.rules.state ?? 'any'],
    t.rules.fees ? 'fees' : null,
    t.rules.library ? 'library' : null,
    t.rules.hostel ? 'hostel' : null,
    t.rules.transport ? 'transport' : null,
    t.rules.classes?.length ? `classes ${t.rules.classes.join(', ')}` : null,
    t.multiple === 'ONE' ? 'one a person' : t.multiple === 'YEAR' ? 'one a year' : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** Certificate types (docs/design/87, phase B): every type with its checks and layout; a type of the school's own. */
export default async function CertificateTypesPage({
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
          { label: 'Certificate types' },
        ]}
      />
      <PageHeader
        kicker="Certificate set-up"
        title="Certificate types"
        description="Open a type to change its name, prefix, layouts, checks, who may issue it and the fields it asks for."
      />
      <Notice params={sp} />
      <Card>
        <DataTable<T>
          caption="Certificate types"
          density="dense"
          columns={[
            {
              key: 'name',
              header: 'Type',
              render: (t) => (
                <a href={`/certificates/setup/types/${t.code}`}>
                  <strong>{t.name}</strong>
                </a>
              ),
            },
            {
              key: 'who',
              header: 'For',
              render: (t) => (t.audience === 'STAFF' ? 'Staff' : 'Students'),
            },
            { key: 'prefix', header: 'Prefix', render: (t) => t.prefix },
            {
              key: 'template',
              header: 'Template',
              render: (t) =>
                t.template ? (
                  <>
                    {t.template}
                    {t.variants ? ` (+${String(t.variants)})` : ''}
                  </>
                ) : (
                  <Badge tone="warning">None</Badge>
                ),
            },
            { key: 'checks', header: 'Checks', render: checksOf },
            { key: 'issued', header: 'Issued', render: (t) => String(t.issued) },
            {
              key: 'status',
              header: 'Status',
              render: (t) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'On' : 'Off'}</Badge>
                  {t.restricted ? <Badge tone="info">Some roles</Badge> : null}
                  {t.builtIn ? null : <Badge tone="info">School's own</Badge>}
                </span>
              ),
            },
          ]}
          rows={o.types}
          rowKey={(t) => t.code}
          emptyTitle="No types"
        />
      </Card>
      <Card title="Add a type of the school's own">
        <form action={createCertificateType} className="ep-cert-fields">
          <label className="ep-field" htmlFor="ntName">
            <span className="ep-field__label">Name *</span>
            <input
              id="ntName"
              name="name"
              className="ep-input"
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label className="ep-field" htmlFor="ntCode">
            <span className="ep-field__label">Code * (capitals, e.g. SPORTS)</span>
            <input
              id="ntCode"
              name="code"
              className="ep-input"
              required
              pattern="[A-Za-z][A-Za-z0-9_]{1,19}"
              maxLength={20}
            />
          </label>
          <label className="ep-field" htmlFor="ntPrefix">
            <span className="ep-field__label">Number prefix * (e.g. SPT → SPT/2026-27/00001)</span>
            <input
              id="ntPrefix"
              name="prefix"
              className="ep-input"
              required
              pattern="[A-Za-z][A-Za-z0-9]{0,7}"
              maxLength={8}
            />
          </label>
          <SelectField
            id="ntAudience"
            name="audience"
            label="For"
            defaultValue="STUDENT"
            options={[
              { value: 'STUDENT', label: 'Students' },
              { value: 'STAFF', label: 'Staff' },
            ]}
          />
          <SelectField
            id="ntCopy"
            name="copyTemplateId"
            label="Start from a copy of"
            defaultValue=""
            options={[
              { value: '', label: 'A plain certificate' },
              ...o.templates.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <div>
            <Button type="submit">Add the type</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
