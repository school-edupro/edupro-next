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
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { bulkIssueCertificates } from '@/lib/certificate-actions';
import { FIELD_PREFIX, dmy, type BulkPreview, type CertificateType } from '@/lib/certificates';

type Row = BulkPreview['rows'][number];

/**
 * Bulk issue (docs/design/87, phase E): one type to a section's students on the rolls or to the leavers, in roll
 * order; the preview shows each one's checks; the issue leaves out who cannot have it (with the reason) and prints the
 * batch as one PDF.
 */
export default async function BulkIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.issue')) notFound();
  const [types, sections, batches] = await Promise.all([
    apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) =>
      r.rows.filter((t) => t.active && t.audience === 'STUDENT'),
    ),
    apiFetch<{ data: Array<{ id: string; label: string }> }>('/people/sections')
      .then((r) => r.data)
      .catch(() => [] as Array<{ id: string; label: string }>),
    apiFetch<{
      rows: Array<{
        id: string;
        title: string;
        typeName: string;
        issued: number;
        skipped: number;
        by: string | null;
        createdAt: string;
      }>;
    }>('/certificates/batches').then((r) => r.rows),
  ]);
  const type = types.find((t) => t.code === sp.type) ?? null;
  const leavers = sp.scope === 'leavers';
  const section = /^\d{1,18}$/.test(sp.section ?? '') ? sp.section! : '';
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp))
    if (k.startsWith(FIELD_PREFIX) && typeof v === 'string' && v.trim())
      fields[k.slice(FIELD_PREFIX.length)] = v;
  let preview: BulkPreview | null = null;
  let error: string | null = null;
  if (type && (leavers || section))
    try {
      preview = await apiFetch<BulkPreview>('/certificates/bulk/preview', {
        method: 'POST',
        body: JSON.stringify({
          typeCode: type.code,
          ...(leavers ? { leavers: true } : { sectionId: section }),
          purpose: sp.purpose || undefined,
          fields,
        }),
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      error = e.problem.detail ?? e.problem.type;
    }
  const failing = preview ? preview.figures.failed : 0;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Bulk issue' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Bulk issue"
        description="One type to a section or to the leavers, in roll order: each gets its own number; one PDF prints the batch."
      />
      <Notice params={sp} />
      <Card>
        <form method="get" className="ep-cert-fields">
          <SelectField
            id="type"
            name="type"
            label="Certificate"
            defaultValue={type?.code ?? ''}
            options={[
              { value: '', label: 'Choose…' },
              ...types.map((t) => ({ value: t.code, label: t.name })),
            ]}
          />
          <SelectField
            id="scope"
            name="scope"
            label="To"
            defaultValue={leavers ? 'leavers' : 'section'}
            options={[
              { value: 'section', label: 'A section (students on the rolls)' },
              { value: 'leavers', label: 'The leavers (withdrawal cleared, no TC yet)' },
            ]}
          />
          <SelectField
            id="section"
            name="section"
            label="Section"
            defaultValue={section}
            options={[
              { value: '', label: 'Choose…' },
              ...sections.map((s) => ({ value: s.id, label: s.label })),
            ]}
          />
          <label className="ep-field" htmlFor="purpose">
            <span className="ep-field__label">Purpose (printed, optional)</span>
            <input
              id="purpose"
              name="purpose"
              className="ep-input"
              defaultValue={sp.purpose ?? ''}
              maxLength={200}
            />
          </label>
          {type?.fields.map((f) => (
            <label key={f.key} className="ep-field" htmlFor={`${FIELD_PREFIX}${f.key}`}>
              <span className="ep-field__label">
                {f.label}
                {f.required ? ' *' : ''} (the same for all)
              </span>
              {f.kind === 'list' ? (
                <select
                  id={`${FIELD_PREFIX}${f.key}`}
                  name={`${FIELD_PREFIX}${f.key}`}
                  className="ep-input"
                  defaultValue={fields[f.key] ?? ''}
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${FIELD_PREFIX}${f.key}`}
                  name={`${FIELD_PREFIX}${f.key}`}
                  className="ep-input"
                  type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                  defaultValue={fields[f.key] ?? ''}
                />
              )}
            </label>
          ))}
          <div style={{ alignSelf: 'end' }}>
            <Button type="submit" variant="secondary">
              Preview
            </Button>
          </div>
        </form>
      </Card>
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      {preview && type ? (
        <>
          <div className="ep-dash-kpis">
            <KpiTile label="Students" value={String(preview.figures.total)} />
            <KpiTile label="Clear" value={String(preview.figures.ok)} />
            <KpiTile label="A check not clear" value={String(preview.figures.failed)} />
            <KpiTile label="Already hold it" value={String(preview.figures.held)} />
            <KpiTile label="Type" value={preview.type.name} />
            <KpiTile label="Order" value="Roll no." />
          </div>
          <Card>
            <DataTable<Row>
              caption="Who would get it"
              density="dense"
              columns={[
                { key: 'roll', header: 'Roll', render: (r) => r.rollNo ?? '' },
                { key: 'name', header: 'Student', render: (r) => `${r.name} · ${r.admissionNo}` },
                { key: 'class', header: 'Class', render: (r) => r.classLabel ?? '' },
                {
                  key: 'ok',
                  header: 'Checks',
                  render: (r) =>
                    r.ok ? (
                      <Badge tone="success">Clear</Badge>
                    ) : (
                      <>
                        <Badge tone={r.held ? 'neutral' : 'danger'}>
                          {r.held ? 'Holds it' : 'Not clear'}
                        </Badge>{' '}
                        <span className="ep-field__help" style={{ margin: 0 }}>
                          {[
                            ...r.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`),
                            ...r.problems,
                          ].join('; ')}
                        </span>
                      </>
                    ),
                },
              ]}
              rows={preview.rows}
              rowKey={(r) => r.id}
              emptyTitle="No students"
            />
            <form
              action={bulkIssueCertificates}
              style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}
            >
              <input type="hidden" name="type" value={type.code} />
              <input type="hidden" name="scope" value={leavers ? 'leavers' : 'section'} />
              <input type="hidden" name="section" value={section} />
              <input type="hidden" name="purpose" value={sp.purpose ?? ''} />
              {Object.entries(fields).map(([k, v]) => (
                <input key={k} type="hidden" name={`${FIELD_PREFIX}${k}`} value={v} />
              ))}
              {failing && preview.can.override ? (
                <label className="ep-field" htmlFor="overrideReason">
                  <span className="ep-field__label">
                    To issue to the {String(failing)} whose checks are not clear too, say why
                    (optional)
                  </span>
                  <textarea
                    id="overrideReason"
                    name="overrideReason"
                    className="ep-input"
                    rows={2}
                    maxLength={300}
                  />
                </label>
              ) : null}
              <div>
                <Button
                  type="submit"
                  disabled={!preview.figures.ok && !(failing && preview.can.override)}
                >
                  Issue to {String(preview.figures.ok)} student(s)
                  {failing && preview.can.override ? ' (more with a reason)' : ''}
                </Button>
              </div>
            </form>
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
