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
import { DialogButton } from '@/components/leave/DialogButton';
import { Icon } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { createCertificateType } from '@/lib/certificate-setup-actions';
import { checksInWords, onlineInWords, type CertificateSetupOverview } from '@/lib/certificates';

type T = CertificateSetupOverview['types'][number];

/**
 * Certificate types (docs/design/87; rebuilt 16 Nov 2026): the figures, a search and filters, the student and the staff
 * certificates in two groups — each with its next number, what is checked before issue and who may ask for it online,
 * in words — an Edit button on every row, and "Add a type" in a dialog.
 */
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
  const q = (sp.q ?? '').trim().toLowerCase();
  const who = sp.for === 'students' || sp.for === 'staff' ? sp.for : '';
  const status = sp.status === 'on' || sp.status === 'off' ? sp.status : '';
  const shown = o.types.filter(
    (t) =>
      (!q || `${t.name} ${t.prefix} ${t.code}`.toLowerCase().includes(q)) &&
      (!who || (who === 'staff') === (t.audience === 'STAFF')) &&
      (!status || (status === 'on') === t.active),
  );
  const students = shown.filter((t) => t.audience !== 'STAFF');
  const staff = shown.filter((t) => t.audience === 'STAFF');
  const filtered = !!(q || who || status);

  const columns = (isStaff: boolean) => [
    {
      key: 'name',
      header: 'Certificate',
      render: (t: T) => (
        <>
          <a href={`/certificates/setup/types/${t.code}`}>
            <strong>{t.name}</strong>
          </a>
          <span className="ep-ctype__num">
            {t.template
              ? `Next: ${t.nextNumber ?? `${t.prefix}/…`}`
              : 'No layout: cannot be issued'}
          </span>
        </>
      ),
    },
    {
      key: 'checks',
      header: 'Checked before issue',
      render: (t: T) => checksInWords(t.rules, t.multiple, isStaff),
    },
    {
      key: 'online',
      header: 'Asked for online',
      render: (t: T) => onlineInWords(t.request, isStaff),
    },
    {
      key: 'issued',
      header: o.yearCode ? `Issued in ${o.yearCode}` : 'Issued',
      render: (t: T) => (
        <>
          {String(t.issuedYear)}
          <span className="ep-ctype__num">{String(t.issued)} in all</span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t: T) => (
        <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
          <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'On' : 'Off'}</Badge>
          {t.template ? null : <Badge tone="warning">No layout</Badge>}
          {t.waiting ? <Badge tone="info">{`${String(t.waiting)} waiting`}</Badge> : null}
          {t.restricted ? <Badge tone="neutral">Some roles</Badge> : null}
          {t.builtIn ? null : <Badge tone="neutral">School&apos;s own</Badge>}
        </span>
      ),
    },
    {
      key: 'edit',
      header: 'Change',
      render: (t: T) => (
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/certificates/setup/types/${t.code}`}
        >
          <Icon name="pencil" size={16} /> Edit<span className="ep-sr-only"> {t.name}</span>
        </a>
      ),
    },
  ];

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
        description="Every certificate the school gives: what is checked before it is issued and who may ask for it online. Edit one to change it."
        actions={
          <DialogButton
            id="add-type"
            label={
              <>
                <Icon name="plus" size={16} /> Add a type
              </>
            }
            title="Add a type of the school's own"
          >
            <form action={createCertificateType} className="ep-cert-fields">
              <label className="ep-field" htmlFor="ntName" style={{ gridColumn: '1 / -1' }}>
                <span className="ep-field__label">Name *</span>
                <input
                  id="ntName"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="e.g. Sports certificate"
                />
                <span className="ep-field__help">Printed as the certificate&apos;s heading.</span>
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
              <label className="ep-field" htmlFor="ntPrefix">
                <span className="ep-field__label">Number prefix *</span>
                <input
                  id="ntPrefix"
                  name="prefix"
                  className="ep-input"
                  required
                  pattern="[A-Za-z][A-Za-z0-9]{0,7}"
                  maxLength={8}
                  placeholder="e.g. SPT"
                />
                <span className="ep-field__help">
                  Letters before the number: SPT → SPT/{o.yearCode ?? '2026-27'}/00001.
                </span>
              </label>
              <div style={{ gridColumn: '1 / -1' }}>
                <SelectField
                  id="ntCopy"
                  name="copyTemplateId"
                  label="Start its layout from"
                  defaultValue=""
                  options={[
                    { value: '', label: 'A plain certificate' },
                    ...o.templates.map((t) => ({
                      value: t.id,
                      label: `A copy of ${t.ready ? t.name : `${t.name} (school's copy)`}`,
                    })),
                  ]}
                />
              </div>
              <p className="ep-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
                Next, its page opens to set its checks, who may issue it and what it asks for.
              </p>
              <div>
                <Button type="submit">Add the type</Button>
              </div>
            </form>
          </DialogButton>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Types" value={String(o.figures.types)} />
        <KpiTile label="Switched on" value={String(o.figures.active)} />
        <KpiTile label="Asked for online" value={String(o.figures.online)} />
        <KpiTile label="With a fee" value={String(o.figures.withFee)} />
        <KpiTile
          label={o.yearCode ? `Issued in ${o.yearCode}` : 'Issued this year'}
          value={String(o.figures.issuedYear)}
        />
        <KpiTile label="To fix (no layout)" value={String(o.figures.toFix)} />
      </div>
      <form method="get" className="ep-ctype__filters" role="search" aria-label="Find a type">
        <label className="ep-field ep-field--grow" htmlFor="fq">
          <span className="ep-field__label">Search</span>
          <input
            id="fq"
            name="q"
            type="search"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Name or prefix"
          />
        </label>
        <SelectField
          id="ffor"
          name="for"
          label="For"
          defaultValue={who}
          options={[
            { value: '', label: 'Students and staff' },
            { value: 'students', label: 'Students' },
            { value: 'staff', label: 'Staff' },
          ]}
        />
        <SelectField
          id="fstatus"
          name="status"
          label="Status"
          defaultValue={status}
          options={[
            { value: '', label: 'On and off' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <div className="ep-ctype__actions">
          <Button type="submit" variant="secondary">
            Show
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/certificates/setup/types">
              Clear
            </a>
          ) : null}
        </div>
      </form>
      <div className="ep-ctype__group">
        {!who || who === 'students' ? (
          <Card title={`Student certificates (${String(students.length)})`}>
            <DataTable<T>
              caption="Student certificates"
              density="dense"
              columns={columns(false)}
              rows={students}
              rowKey={(t) => t.code}
              emptyTitle={filtered ? 'None match the search' : 'No student certificates'}
            />
          </Card>
        ) : null}
        {!who || who === 'staff' ? (
          <Card title={`Staff certificates (${String(staff.length)})`}>
            <DataTable<T>
              caption="Staff certificates"
              density="dense"
              columns={columns(true)}
              rows={staff}
              rowKey={(t) => t.code}
              emptyTitle={filtered ? 'None match the search' : 'No staff certificates'}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
