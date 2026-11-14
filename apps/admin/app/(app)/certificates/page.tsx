import { Badge, Button, Card, DataTable, KpiTile, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { Pager, pageSizeOf } from '@/components/Pager';
import { DownloadMenu } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  dmy,
  type Certificate,
  type CertificateList,
  type CertificateType,
} from '@/lib/certificates';

/**
 * The certificate register (docs/design/87): every certificate the school has issued — TC, bonafide, character, date
 * of birth … — with its number, copy, the student, who issued it and when, and whether the principal issued it past a
 * failed check; filtered, a page at a time, as Excel or PDF.
 */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.view')) notFound();
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const code = (v?: string) => (v && /^[A-Z][A-Z0-9_]{1,19}$/.test(v) ? v : '');
  const size = pageSizeOf(sp.size);
  const filters = new URLSearchParams();
  if (code(sp.type)) filters.set('type', code(sp.type));
  if (sp.status === 'issued' || sp.status === 'cancelled') filters.set('status', sp.status);
  if (sp.copy === 'original' || sp.copy === 'duplicate') filters.set('copy', sp.copy);
  if (sp.override === 'yes') filters.set('override', 'yes');
  if (sp.year && /^[0-9A-Za-z-]{2,12}$/.test(sp.year)) filters.set('year', sp.year);
  if (day(sp.from)) filters.set('from', day(sp.from));
  if (day(sp.to)) filters.set('to', day(sp.to));
  if (sp.q) filters.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(filters);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let list: CertificateList;
  let types: CertificateType[];
  try {
    [list, types] = await Promise.all([
      apiFetch<CertificateList>(`/certificates?${qs.toString()}`),
      apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) => r.rows),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = list.figures;
  const here = (over: Record<string, string>) => {
    const u = new URLSearchParams(filters);
    u.set('size', size);
    for (const [k, v] of Object.entries(over)) u.set(k, v);
    return `/certificates?${u.toString()}`;
  };
  const filtered = filters.toString() !== '';
  return (
    <>
      <PageHeader
        kicker="Certificates"
        title="Certificate register"
        description="Every certificate the school issues: one register and one numbering per type and year, never reused. A duplicate keeps the number and prints DUPLICATE."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {list.can.issue ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/certificates/issue">
                Issue a certificate
              </a>
            ) : null}
            {list.can.setup ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/certificates/setup">
                Set-up
              </a>
            ) : null}
            <DownloadMenu
              xlsx={`/api/certificates-file?format=xlsx&${filters.toString()}`}
              pdf={`/api/certificates-file?format=pdf&${filters.toString()}`}
            />
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label={filtered ? 'In this list' : 'All certificates'} value={String(f.total)} />
        <KpiTile label="Issued (originals)" value={String(f.issued)} />
        <KpiTile label="This month" value={String(f.month)} />
        <KpiTile label="Duplicates" value={String(f.duplicates)} />
        <KpiTile label="Cancelled" value={String(f.cancelled)} />
        <KpiTile label="Issued past a check" value={String(f.overrides)} />
      </div>
      <Card>
        <form
          method="get"
          aria-label="Filter the register"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="type"
            name="type"
            label="Type"
            defaultValue={code(sp.type)}
            options={[
              { value: '', label: 'All types' },
              ...types.map((t) => ({ value: t.code, label: t.name })),
            ]}
          />
          <SelectField
            id="status"
            name="status"
            label="Status"
            defaultValue={filters.get('status') ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'issued', label: 'Issued' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <SelectField
            id="copy"
            name="copy"
            label="Copy"
            defaultValue={filters.get('copy') ?? ''}
            options={[
              { value: '', label: 'Originals and duplicates' },
              { value: 'original', label: 'Originals' },
              { value: 'duplicate', label: 'Duplicates' },
            ]}
          />
          <SelectField
            id="override"
            name="override"
            label="Checks"
            defaultValue={filters.get('override') ?? ''}
            options={[
              { value: '', label: 'Any' },
              { value: 'yes', label: 'Issued past a failed check' },
            ]}
          />
          <SelectField
            id="year"
            name="year"
            label="Year"
            defaultValue={filters.get('year') ?? ''}
            options={[
              { value: '', label: 'All years' },
              ...list.years.map((y) => ({ value: y, label: y })),
            ]}
          />
          <label className="ep-field" htmlFor="from" style={{ margin: 0 }}>
            <span className="ep-field__label">Issued from</span>
            <input
              id="from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={day(sp.from)}
            />
          </label>
          <label className="ep-field" htmlFor="to" style={{ margin: 0 }}>
            <span className="ep-field__label">Issued to</span>
            <input id="to" name="to" type="date" className="ep-input" defaultValue={day(sp.to)} />
          </label>
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Number, name, admission no. or Emp. ID</span>
            <input id="q" name="q" className="ep-input" defaultValue={sp.q ?? ''} maxLength={80} />
          </label>
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={size}
            options={['25', '50', '100'].map((n) => ({ value: n, label: n }))}
          />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/certificates">
              Clear
            </a>
          ) : null}
        </form>
        <DataTable<Certificate>
          caption="Certificate register"
          density="dense"
          columns={[
            {
              key: 'no',
              header: 'Number',
              render: (x) => (
                <a href={`/certificates/${x.id}`}>
                  <strong>{x.number}</strong>
                </a>
              ),
            },
            {
              key: 'copy',
              header: 'Copy',
              render: (x) =>
                x.copyNo ? <Badge tone="warning">Duplicate {x.copyNo}</Badge> : 'Original',
            },
            { key: 'type', header: 'Type', render: (x) => x.typeName },
            {
              key: 'student',
              header: 'Student / employee',
              render: (x) =>
                x.studentId || x.employeeId ? (
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
                  ''
                ),
            },
            { key: 'class', header: 'Class', render: (x) => x.className ?? '' },
            { key: 'on', header: 'Issued on', render: (x) => dmy(x.issuedOn) },
            {
              key: 'book',
              header: 'Book / Sl. no.',
              render: (x) => (x.bookNo ? `${String(x.bookNo)} / ${String(x.slNo ?? '')}` : ''),
            },
            { key: 'by', header: 'Issued by', render: (x) => x.issuedBy ?? '' },
            {
              key: 'status',
              header: 'Status',
              render: (x) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  <Badge tone={x.status === 'issued' ? 'success' : 'danger'}>
                    {x.status === 'issued' ? 'Issued' : 'Cancelled'}
                  </Badge>
                  {x.overrideReason ? <Badge tone="warning">Past a check</Badge> : null}
                  {x.legacy ? <Badge tone="neutral">Old system</Badge> : null}
                </span>
              ),
            },
            {
              key: 'pdf',
              header: 'PDF',
              render: (x) =>
                x.exportId ? (
                  <FileLinks
                    href={`/reports/exports/${x.exportId}/download`}
                    label={`${x.typeName} ${x.number}${x.copyNo ? ` duplicate ${String(x.copyNo)}` : ''}`}
                  />
                ) : (
                  <a href={`/certificates/${x.id}`}>Make the PDF</a>
                ),
            },
          ]}
          rows={list.rows}
          rowKey={(x) => x.id}
          emptyTitle={
            filtered ? 'No certificate matches these filters' : 'No certificate issued yet'
          }
        />
        <Pager
          page={Math.max(1, Number(sp.page) || 1)}
          size={Number(size)}
          total={list.total}
          href={(p) => here({ page: String(p) })}
          noun="certificates"
        />
      </Card>
    </>
  );
}
