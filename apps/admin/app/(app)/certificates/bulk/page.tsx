import { Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BulkPreviewTicks } from '@/components/certificates/BulkPreviewTicks';
import { BulkScopePicker, type PickerType } from '@/components/certificates/BulkScopePicker';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { bulkRunCertificates } from '@/lib/certificate-actions';
import {
  FIELD_PREFIX,
  NO_DEPT,
  dmy,
  type BulkClasses,
  type BulkDepartments,
  type BulkPreview,
  type CertificateType,
} from '@/lib/certificates';

const all = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const one = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

/**
 * Bulk issue (docs/design/87; 16 Nov 2026): a student certificate to several classes and sections (one tick list) or
 * to the leavers, or a staff certificate to departments (in service or who have left); the preview lists everyone with
 * their checks and a tick each; the issue makes a batch and a PDF for each section or department.
 */
export default async function BulkIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.issue')) notFound();
  const [types, classes, departments, batches] = await Promise.all([
    apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) =>
      r.rows.filter((t) => t.active),
    ),
    apiFetch<BulkClasses>('/certificates/bulk/sections').catch(
      () => ({ classes: [], max: 600 }) as BulkClasses,
    ),
    apiFetch<BulkDepartments>('/certificates/bulk/departments').catch(
      () => ({ departments: [], max: 600 }) as BulkDepartments,
    ),
    apiFetch<{
      rows: Array<{
        id: string;
        title: string;
        issued: number;
        skipped: number;
        by: string | null;
        createdAt: string;
      }>;
    }>('/certificates/batches').then((r) => r.rows),
  ]);
  const ordered = [
    ...types.filter((t) => t.audience === 'STUDENT'),
    ...types.filter((t) => t.audience === 'STAFF'),
  ];
  const type = ordered.find((t) => t.code === one(sp.type)) ?? null;
  const staff = type?.audience === 'STAFF';
  const scope = staff ? 'departments' : one(sp.scope) === 'leavers' ? 'leavers' : 'sections';
  const sections = all(sp.section).filter((x) => /^\d{1,18}$/.test(x));
  const depts = all(sp.dept).filter((x) => x.length <= 80);
  const state = one(sp.state) === 'left' ? 'left' : 'active';
  const purpose = one(sp.purpose);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp))
    if (k.startsWith(FIELD_PREFIX) && one(v).trim()) fields[k.slice(FIELD_PREFIX.length)] = one(v);
  const max = classes.max;

  let preview: BulkPreview | null = null;
  let error: string | null = null;
  const ready =
    type && (scope === 'leavers' || (scope === 'sections' ? sections.length : depts.length));
  if (ready)
    try {
      preview = await apiFetch<BulkPreview>('/certificates/bulk/preview', {
        method: 'POST',
        body: JSON.stringify({
          typeCode: type.code,
          ...(scope === 'leavers'
            ? { leavers: true }
            : scope === 'departments'
              ? { departments: depts.map((d) => (d === NO_DEPT ? '' : d)), staffState: state }
              : { sectionIds: sections }),
          purpose: purpose || undefined,
          fields,
        }),
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      error = e.problem.detail ?? e.problem.type;
    }

  // what the issue posts, besides the ticks
  const hidden: Array<[string, string]> = [
    ['type', type?.code ?? ''],
    ['scope', scope],
    ...sections.map((x) => ['section', x] as [string, string]),
    ...depts.map((x) => ['dept', x] as [string, string]),
    ['state', state],
    ['purpose', purpose],
    ...Object.entries(fields).map(([k, v]) => [`${FIELD_PREFIX}${k}`, v] as [string, string]),
  ];
  const pickerTypes: PickerType[] = ordered.map((t) => ({
    code: t.code,
    name: t.name,
    audience: t.audience,
    fields: t.fields,
  }));

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Bulk issue' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Bulk issue"
        description="A student certificate to several classes and sections, or a staff certificate to departments: tick who gets one; each gets its own number, and each section or department its own PDF."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/certificates/imports">
            From Excel — each with their own details
          </a>
        }
      />
      <Notice
        params={Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v) || undefined]))}
      />
      <Card>
        <BulkScopePicker
          types={pickerTypes}
          classes={classes.classes}
          departments={departments.departments}
          max={max}
          initial={{
            type: type?.code ?? '',
            scope,
            sections,
            depts,
            state,
            purpose,
            fields,
          }}
        />
      </Card>
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      {preview && type ? (
        <>
          <div className="ep-dash-kpis">
            <KpiTile
              label={staff ? 'Employees' : 'Students'}
              value={String(preview.figures.total)}
            />
            <KpiTile label="Clear" value={String(preview.figures.ok)} />
            <KpiTile label="A check not clear" value={String(preview.figures.failed)} />
            <KpiTile label="Already hold it" value={String(preview.figures.held)} />
            <KpiTile
              label={staff ? 'Departments (a PDF each)' : 'Sections (a PDF each)'}
              value={String(scope === 'leavers' ? 1 : preview.figures.sections)}
            />
            <KpiTile label="Certificate" value={preview.type.name} />
          </div>
          <Card title={`Who gets it — ${type.name}`}>
            {preview.rows.length ? (
              <BulkPreviewTicks
                rows={preview.rows}
                canOverride={preview.can.override}
                staff={staff}
                max={max}
                action={bulkRunCertificates}
                hidden={hidden}
              />
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                No {staff ? 'employees' : 'students'} here.
              </p>
            )}
          </Card>
        </>
      ) : null}
      <Card title="Earlier batches">
        {batches.length ? (
          <ul className="ep-cert-checks">
            {batches.slice(0, 20).map((b) => (
              <li key={b.id}>
                <a href={`/certificates/batches/${b.id}`}>{b.title}</a> ·{' '}
                {dmy(b.createdAt.slice(0, 10))} · {String(b.issued)} issued
                {b.skipped ? `, ${String(b.skipped)} left out` : ''}
                {b.by ? ` · ${b.by}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No batch yet.
          </p>
        )}
      </Card>
    </>
  );
}
