import { Alert, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { RegisterDownloads } from '@/components/exams/RegisterDownloads';
import { RegisterSheet } from '@/components/exams/RegisterSheet';
import { ApiError, apiFetch } from '@/lib/api';
import type { GradeRunResponse } from '@/lib/grade-registers';

const REPORTS: Array<{ key: GradeRunResponse['report']; label: string }> = [
  { key: 'sheet', label: 'Grade sheet' },
  { key: 'summary', label: 'Grade summary' },
  { key: 'analysis', label: 'Analysis (this section)' },
  { key: 'analysis-all', label: 'Analysis (all sections)' },
];

/**
 * Run a grade register (docs/design/69, part 3), as the legacy Grade Register's Run: pick the section,
 * the layout (the class sheet, or student-wise) and filter by area and item; the Grade summary (a count
 * opens its students), the Analysis of the section or of every section side by side. Download what is
 * shown as PDF (the paper asked) or Excel, the section or every section.
 */
export default async function GradeRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    classSectionId?: string;
    layout?: string;
    report?: string;
    area?: string | string[];
    item?: string | string[];
  }>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const sp = await searchParams;
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
  const report = REPORTS.find((r) => r.key === sp.report)?.key ?? 'sheet';
  const layout = sp.layout === 'student' ? 'student' : 'class';
  const areas = list(sp.area).filter((x) => x.length <= 80 && !x.includes('|'));
  const items = list(sp.item).filter((x) => /^\d{1,18}$/.test(x));
  const shown: Record<string, string> = {
    ...(sp.classSectionId && /^\d{1,18}$/.test(sp.classSectionId)
      ? { classSectionId: sp.classSectionId }
      : {}),
    layout,
    report,
    ...(areas.length ? { areas: areas.join('|') } : {}),
    ...(items.length ? { items: items.join(',') } : {}),
  };
  const run = await apiFetch<GradeRunResponse>(
    `/exams/grade-registers/${id}/run?${new URLSearchParams(shown).toString()}`,
  ).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  });
  const reg = run.register;
  const placeLabel = run.places.find((p) => p.value === run.place)?.label ?? '';
  const linkTo = (r: GradeRunResponse['report']) => {
    const q = new URLSearchParams({
      ...(run.place ? { classSectionId: run.place } : {}),
      layout,
      report: r,
    });
    for (const a of areas) q.append('area', a);
    for (const it of items) q.append('item', it);
    return `/exams/grade-registers/${reg.id}/run?${q.toString()}`;
  };
  const reportLabel = REPORTS.find((r) => r.key === report)!.label;
  const filtered = areas.length > 0 || items.length > 0;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Grade registers', href: '/exams/grade-registers' },
          { label: reg.name },
          { label: 'Run' },
        ]}
      />
      <PageHeader
        kicker={`Run · version ${String(reg.version)}${reg.status === 'draft' ? ' (draft)' : ''}`}
        title={`▶ ${reg.name}`}
        description={`${reportLabel}${report === 'analysis-all' ? '' : ` · ${placeLabel}`} · ${run.exams.map((e) => `${e.label} = ${e.name}`).join(' · ')}${reg.accessType === 'mapping' ? ' · Access: as per mapping' : ''}`}
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-streg-form">
          <input type="hidden" name="report" value={report} />
          <div className="ep-mr-toolbar">
            {report !== 'analysis-all' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '12rem' }}>
                <span className="ep-field__label">Section</span>
                <select className="ep-select" name="classSectionId" defaultValue={run.place ?? ''}>
                  {run.places.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {report === 'sheet' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '12rem' }}>
                <span className="ep-field__label">Layout</span>
                <select className="ep-select" name="layout" defaultValue={layout}>
                  <option value="class">Class sheet</option>
                  <option value="student">Student-wise</option>
                </select>
              </label>
            ) : (
              <input type="hidden" name="layout" value={layout} />
            )}
          </div>
          {run.areas.length > 1 || run.items.length > 1 ? (
            <details className="ep-gr-filter" open={filtered}>
              <summary>
                Filter
                {filtered
                  ? `: ${String(areas.length || 'all')} area(s), ${String(items.length || 'all')} indicator(s)`
                  : ''}
              </summary>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Areas (none ticked: every area)</legend>
                <div className="ep-mr-tiles">
                  {run.areas.map((a) => (
                    <label key={a.key} className="ep-mr-tile">
                      <input
                        type="checkbox"
                        name="area"
                        value={a.key}
                        defaultChecked={areas.includes(a.key)}
                      />
                      <span>{a.name || 'Indicators'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Indicators (none ticked: every one)</legend>
                <div className="ep-mr-tiles">
                  {run.items.map((it) => (
                    <label key={it.key} className="ep-mr-tile">
                      <input
                        type="checkbox"
                        name="item"
                        value={it.key}
                        defaultChecked={items.includes(it.key)}
                      />
                      <span>
                        {it.name}
                        <small>{run.areas.find((a) => a.key === it.area)?.name ?? ''}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </details>
          ) : null}
          <div className="ep-mr-toolbar">
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Show
            </button>
            {filtered ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/exams/grade-registers/${reg.id}/run?${new URLSearchParams({
                  ...(run.place ? { classSectionId: run.place } : {}),
                  layout,
                  report,
                }).toString()}`}
              >
                Clear the filter
              </a>
            ) : null}
          </div>
          <AutoSubmit />
        </form>
        <div className="ep-mr-toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <nav aria-label="Reports">
            <ul className="ep-xchips">
              {REPORTS.map((r) => (
                <li key={r.key} style={{ padding: 0, border: 0, background: 'none' }}>
                  <a href={linkTo(r.key)} aria-current={r.key === report ? 'page' : undefined}>
                    {r.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <span style={{ flex: 1 }} />
          {run.sheets.length ? (
            <RegisterDownloads
              target={{
                path: `/api/grade-register/${reg.id}`,
                query: { ...shown, ...(run.place ? { classSectionId: run.place } : {}) },
                all: { all: '1' },
              }}
            />
          ) : null}
        </div>
      </Card>
      {run.notes.length ? (
        <Alert tone="info">
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {run.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {!run.places.length ? (
        <Alert tone="info">
          No section of this register&apos;s classes has students this year.
        </Alert>
      ) : null}
      {run.sheets.length ? (
        <Card elevated style={{ marginTop: 'var(--sp-4)' }}>
          {run.sheets.map((sheet, i) => (
            <section key={`${sheet.place}-${String(i)}`} className="ep-streg-sheet">
              {sheet.title ? <h2 className="ep-streg-title">{sheet.title}</h2> : null}
              {sheet.note ? <p className="ep-field__help">{sheet.note}</p> : null}
              <RegisterSheet sheet={sheet} label={`${reg.name} · ${sheet.title ?? sheet.place}`} />
            </section>
          ))}
        </Card>
      ) : null}
    </>
  );
}
