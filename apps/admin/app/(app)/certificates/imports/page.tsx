import { Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BulkScopePicker, type PickerType } from '@/components/certificates/BulkScopePicker';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { uploadCertificateSheet } from '@/lib/certificate-import-actions';
import {
  dmy,
  type BulkClasses,
  type BulkDepartments,
  type CertificateImportSummary,
  type CertificateType,
} from '@/lib/certificates';

type S = CertificateImportSummary;

/**
 * Issue from Excel (docs/design/87, 17 Nov 2026; e.g. the Class XII TCs after the board result): choose the certificate
 * and who it is for and download its sheet — one row a person, filled from the records, the columns that certificate
 * needs; fill or correct it; upload it. Nothing is issued on upload: each row is checked first, on the upload's page.
 */
export default async function CertificateImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.issue')) notFound();
  const [types, classes, departments, uploads] = await Promise.all([
    apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) =>
      r.rows.filter((t) => t.active),
    ),
    apiFetch<BulkClasses>('/certificates/bulk/sections').catch(
      () => ({ classes: [], max: 600 }) as BulkClasses,
    ),
    apiFetch<BulkDepartments>('/certificates/bulk/departments').catch(
      () => ({ departments: [], max: 600 }) as BulkDepartments,
    ),
    apiFetch<{ rows: S[] }>('/certificates/imports').then((r) => r.rows),
  ]);
  const ordered = [
    ...types.filter((t) => t.audience === 'STUDENT'),
    ...types.filter((t) => t.audience === 'STAFF'),
  ];
  const type = ordered.find((t) => t.code === sp.type) ?? null;
  const pickerTypes: PickerType[] = ordered.map((t) => ({
    code: t.code,
    name: t.name,
    audience: t.audience,
    fields: t.fields,
  }));
  const label = (t: CertificateType) => `${t.name}${t.audience === 'STAFF' ? ' (staff)' : ''}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Bulk issue', href: '/certificates/bulk' },
          { label: 'From Excel' },
        ]}
      />
      <PageHeader
        kicker="Certificates"
        title="Issue from Excel"
        description="Download a certificate's sheet for a class (or the leavers, or a department) — a row for each person, filled from the records — fill or correct it in Excel, and upload it. Every row is checked before anything is issued."
      />
      <Notice params={sp} />
      <Card title="1. Download the sheet">
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Choose the certificate and who it is for. The sheet has the columns that certificate needs
          — for a TC its details (reason, dates, conduct …) and what it prints about the student —
          already filled where the records hold them, with drop-downs for the list answers.
        </p>
        <BulkScopePicker
          mode="sheet"
          types={pickerTypes}
          classes={classes.classes}
          departments={departments.departments}
          max={classes.max}
          initial={{
            type: type?.code ?? '',
            scope: 'sections',
            sections: [],
            depts: [],
            state: 'active',
            purpose: '',
            fields: {},
          }}
        />
      </Card>
      <Card title="2. Upload the filled sheet">
        <form action={uploadCertificateSheet} className="ep-cert-fields">
          <SelectField
            id="upType"
            name="type"
            label="Certificate"
            required
            defaultValue={type?.code ?? ''}
            options={[
              { value: '', label: 'Choose…' },
              ...ordered.map((t) => ({ value: t.code, label: label(t) })),
            ]}
          />
          <label className="ep-field" htmlFor="upTitle">
            <span className="ep-field__label">Name of the upload (optional)</span>
            <input
              id="upTitle"
              name="title"
              className="ep-input"
              maxLength={200}
              placeholder="e.g. TC · Class XII, 2026-27"
            />
          </label>
          <label className="ep-field" htmlFor="upFile" style={{ gridColumn: '1 / -1' }}>
            <span className="ep-field__label">The filled sheet *</span>
            <input
              id="upFile"
              name="file"
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="ep-input"
              required
            />
            <span className="ep-field__help">
              Nothing is issued yet: the next page shows each row as ready or with what to fix.
            </span>
          </label>
          <div>
            <Button type="submit">Upload and check</Button>
          </div>
        </form>
      </Card>
      <Card title="Earlier uploads">
        <DataTable<S>
          caption="Earlier uploads"
          density="dense"
          columns={[
            {
              key: 'title',
              header: 'Upload',
              render: (x) => (
                <>
                  <a href={`/certificates/imports/${x.id}`}>
                    <strong>{x.title}</strong>
                  </a>
                  <span className="ep-ctype__num" style={{ whiteSpace: 'normal' }}>
                    {x.typeName}
                    {x.uploads > 1 ? ` · uploaded ${String(x.uploads)} times` : ''}
                  </span>
                </>
              ),
            },
            { key: 'total', header: 'Rows', render: (x) => String(x.total) },
            { key: 'issued', header: 'Issued', render: (x) => String(x.issued) },
            { key: 'ready', header: 'Ready', render: (x) => String(x.ready) },
            { key: 'attention', header: 'Need attention', render: (x) => String(x.attention) },
            { key: 'by', header: 'By', render: (x) => x.by ?? '—' },
            { key: 'at', header: 'Changed on', render: (x) => dmy(x.updatedAt.slice(0, 10)) },
          ]}
          rows={uploads}
          rowKey={(x) => x.id}
          emptyTitle="No upload yet"
        />
      </Card>
    </>
  );
}
