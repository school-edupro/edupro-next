import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  KpiTile,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { notFound } from 'next/navigation';
import { TemplateSample } from '@/components/certificates/TemplateSample';
import { DialogButton } from '@/components/leave/DialogButton';
import { Icon } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { copyCertificateTemplate } from '@/lib/certificate-setup-actions';
import {
  dmy,
  paperLabel,
  type CertificateSetupOverview,
  type CertificateTemplateRow,
} from '@/lib/certificates';

type R = CertificateTemplateRow;

/** Where a layout comes from, in words. */
const originOf = (t: R) =>
  t.code === 'cert_legacy'
    ? 'Prints certificates brought from the old system'
    : !t.ready
      ? "The school's copy"
      : t.version > 1
        ? `EduPro's layout, changed by the school (version ${String(t.version)})`
        : "EduPro's ready layout";

/**
 * Certificate templates (docs/design/87; rebuilt 16 Nov 2026): the figures, a search, the layouts used by a certificate
 * type and those used by none in two tables — each with where it comes from, its paper and when it changed — and See
 * (the paper in a pop-up), Edit and Copy on every row; "Make a copy" in a dialog.
 */
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
  const q = (sp.q ?? '').trim().toLowerCase();
  const shown = o.templates.filter(
    (t) => !q || `${t.name} ${t.usedBy.join(' ')}`.toLowerCase().includes(q),
  );
  const used = shown.filter((t) => t.usedBy.length > 0);
  const spare = shown.filter((t) => t.usedBy.length === 0);
  const all = o.templates;

  const copyForm = (t?: R) => (
    <form action={copyCertificateTemplate} className="ep-cert-fields">
      {t ? (
        <input type="hidden" name="copyOf" value={t.id} />
      ) : (
        <div style={{ gridColumn: '1 / -1' }}>
          <SelectField
            id="cpOf"
            name="copyOf"
            label="Copy of"
            defaultValue={all[0]?.id ?? ''}
            options={all.map((x) => ({
              value: x.id,
              label: x.ready ? x.name : `${x.name} (school's copy)`,
            }))}
          />
        </div>
      )}
      <label
        className="ep-field"
        htmlFor={`cpName${t ? t.id : ''}`}
        style={{ gridColumn: '1 / -1' }}
      >
        <span className="ep-field__label">Name of the copy *</span>
        <input
          id={`cpName${t ? t.id : ''}`}
          name="name"
          className="ep-input"
          required
          minLength={2}
          maxLength={120}
          defaultValue={t ? `${t.name} (copy)` : ''}
        />
        <span className="ep-field__help">
          The copy opens next, to change. Give it to a type on the type&apos;s page (Layout), as the
          layout it prints with or one more to choose at issue.
        </span>
      </label>
      <div>
        <Button type="submit">Make the copy</Button>
      </div>
    </form>
  );

  const columns = [
    {
      key: 'name',
      header: 'Layout',
      render: (t: R) => (
        <>
          <a href={`/certificates/setup/templates/${t.id}`}>
            <strong>{t.name}</strong>
          </a>
          <span className="ep-ctype__num" style={{ whiteSpace: 'normal' }}>
            {originOf(t)}
          </span>
        </>
      ),
    },
    {
      key: 'used',
      header: 'Used by',
      render: (t: R) =>
        t.usedBy.length ? t.usedBy.join(', ') : <Badge tone="neutral">No type</Badge>,
    },
    { key: 'paper', header: 'Paper', render: (t: R) => paperLabel(t.pageWidth, t.pageHeight) },
    {
      key: 'made',
      header: 'Certificates made',
      render: (t: R) => String(t.made),
    },
    { key: 'at', header: 'Changed on', render: (t: R) => dmy(t.updatedAt.slice(0, 10)) },
    {
      key: 'act',
      header: 'Actions',
      render: (t: R) => (
        <span className="ep-ctype__actions ep-ctpl__rowacts">
          <DialogButton
            id={`see-${t.id}`}
            className="ep-btn ep-btn--ghost ep-btn--sm"
            label={
              <>
                <Icon name="eye" size={16} /> See<span className="ep-sr-only"> {t.name}</span>
              </>
            }
            title={`How ${t.name} prints`}
          >
            <TemplateSample id={t.id} name={t.name} />
            <p className="ep-field__help">
              With a sample from the school.{' '}
              <a href={`/certificates/setup/templates/${t.id}`}>Edit this layout</a>
            </p>
          </DialogButton>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/certificates/setup/templates/${t.id}`}
          >
            <Icon name="pencil" size={16} /> Edit<span className="ep-sr-only"> {t.name}</span>
          </a>
          <DialogButton
            id={`copy-${t.id}`}
            className="ep-btn ep-btn--ghost ep-btn--sm"
            label={
              <>
                <Icon name="copy" size={16} /> Copy<span className="ep-sr-only"> {t.name}</span>
              </>
            }
            title={`Make a copy of ${t.name}`}
          >
            {copyForm(t)}
          </DialogButton>
        </span>
      ),
    },
  ];

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
        title="Certificate templates"
        description="The layouts certificates print with. See one as it prints, Edit it, or Copy it to make a new one. A saved change applies to the next certificates; those already issued keep their layout."
        actions={
          <DialogButton
            id="copy-new"
            className="ep-btn ep-btn--primary ep-btn--sm ep-ctpl__nowrap"
            label={
              <>
                <Icon name="plus" size={16} /> Make a copy
              </>
            }
            title="Make a copy of a layout"
          >
            {copyForm()}
          </DialogButton>
        }
      />
      {sp.ok === 'copied' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Copy made.
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-dash-kpis">
        <KpiTile label="Layouts" value={String(all.length)} />
        <KpiTile label="Used by a type" value={String(all.filter((t) => t.usedBy.length).length)} />
        <KpiTile
          label="Used by no type"
          value={String(all.filter((t) => !t.usedBy.length).length)}
        />
        <KpiTile
          label="Changed by the school"
          value={String(all.filter((t) => t.ready && t.version > 1).length)}
        />
        <KpiTile label="EduPro's ready layouts" value={String(all.filter((t) => t.ready).length)} />
        <KpiTile label="The school's copies" value={String(all.filter((t) => !t.ready).length)} />
      </div>
      <form method="get" className="ep-ctype__filters" role="search" aria-label="Find a layout">
        <label className="ep-field ep-field--grow" htmlFor="tq">
          <span className="ep-field__label">Search</span>
          <input
            id="tq"
            name="q"
            type="search"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Layout or certificate type"
          />
        </label>
        <div className="ep-ctype__actions">
          <Button type="submit" variant="secondary">
            Find
          </Button>
          {q ? (
            <a className="ep-btn ep-btn--ghost" href="/certificates/setup/templates">
              Clear
            </a>
          ) : null}
        </div>
      </form>
      <div className="ep-ctype__group">
        <Card title={`Used by a certificate type (${String(used.length)})`}>
          <DataTable<R>
            caption="Layouts used by a certificate type"
            density="dense"
            columns={columns}
            rows={used}
            rowKey={(t) => t.id}
            emptyTitle={q ? 'None match the search' : 'No layout is used yet'}
          />
        </Card>
        <Card title={`Used by no type (${String(spare.length)})`}>
          <p className="ep-ctype__note" style={{ marginTop: 0 }}>
            Copies and spare layouts. To use one, open a certificate type and choose it under
            Layout.
          </p>
          <DataTable<R>
            caption="Layouts used by no type"
            density="dense"
            columns={columns}
            rows={spare}
            rowKey={(t) => t.id}
            emptyTitle={q ? 'None match the search' : 'Every layout is used'}
          />
        </Card>
      </div>
    </>
  );
}
