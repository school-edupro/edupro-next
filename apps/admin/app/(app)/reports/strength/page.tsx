import { Card, PageHeader } from '@edupro/ui';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { StrengthFilters, type StrengthOptions } from '@/components/StrengthFilters';
import { exportStrength } from '@/lib/actions';
import { ApiError, apiFetch } from '@/lib/api';

interface Table {
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string; group?: string }>;
  rows: Array<{
    label: string;
    kind: 'row' | 'subtotal' | 'total';
    values: Record<string, number>;
    scope: { classId?: string; classSectionId?: string; stream?: string | null };
  }>;
  meta: { students: number; filters: string[] };
}

type SP = Record<string, string | undefined>;
const KEYS = [
  'report',
  'academicYearId',
  'classIds',
  'sectionIds',
  'groupBy',
  'includeLeft',
  'showEmpty',
  'asOn',
  'discountId',
] as const;

/** Student strength reports: class-wise, category, discount and age, on screen, Excel and PDF. */
export default async function StrengthPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const report = ['classwise', 'category', 'discount', 'age'].includes(sp.report ?? '')
    ? sp.report!
    : 'classwise';
  const options = await apiFetch<StrengthOptions>(
    `/reports/strength/options${sp.academicYearId ? `?academicYearId=${sp.academicYearId}` : ''}`,
  );
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = k === 'report' ? report : sp[k];
    if (v) q.set(k, v);
  }
  if (!q.get('groupBy')) q.set('groupBy', 'section');
  const ready =
    sp.run === '1' &&
    (report !== 'age' || Boolean(sp.asOn)) &&
    (report !== 'discount' || Boolean(sp.discountId));
  let table: Table | null = null;
  let error: string | null = null;
  if (ready)
    table = await apiFetch<Table>(`/reports/strength?${q.toString()}`).catch((e: unknown) => {
      if (e instanceof ApiError) error = String(e.problem.detail ?? e.problem.title ?? 'Not shown');
      else throw e;
      return null;
    });
  const groups: Array<{ label: string | null; span: number }> = [];
  for (const c of table?.columns ?? []) {
    const last = groups[groups.length - 1];
    if (last && c.group && last.label === c.group) last.span += 1;
    else groups.push({ label: c.group ?? null, span: 1 });
  }
  const twoRows = table?.columns.some((c) => c.group) ?? false;
  const studentsHref = (row: Table['rows'][number], column: string) => {
    const s = new URLSearchParams(q);
    s.set('column', column);
    if (row.scope.classId) s.set('classId', row.scope.classId);
    if (row.scope.classSectionId) s.set('classSectionId', row.scope.classSectionId);
    if (row.scope.stream !== undefined) s.set('stream', row.scope.stream ?? '');
    s.set('label', row.label);
    return `/reports/strength/students?${s.toString()}`;
  };
  let sr = 0;
  return (
    <>
      <PageHeader
        kicker="Reports"
        title="Student strength"
        description="Class-wise strength, category, discount and age reports. Filter by class and section; download as Excel or PDF."
      />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Strength reports">
        {options.reports.map((r) => (
          <a
            key={r.id}
            href={`/reports/strength?report=${r.id}`}
            aria-current={report === r.id ? 'page' : undefined}
          >
            {r.title}
          </a>
        ))}
      </nav>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <StrengthFilters
          options={options}
          report={report}
          values={{
            academicYearId: sp.academicYearId,
            classIds: sp.classIds ? sp.classIds.split(',') : [],
            sectionIds: sp.sectionIds ? sp.sectionIds.split(',') : [],
            groupBy: sp.groupBy ?? 'section',
            includeLeft: sp.includeLeft === 'true',
            showEmpty: sp.showEmpty === 'true',
            asOn: sp.asOn,
            discountId: sp.discountId,
          }}
        />
      </Card>
      {sp.export && /^\d+$/.test(sp.export) ? (
        <ExportWatcher
          id={sp.export}
          format={sp.format === 'pdf' ? 'pdf' : 'xlsx'}
          labels={{
            queued: `${sp.format === 'pdf' ? 'PDF' : 'Excel'} requested`,
            ready: 'Strength report',
            pending: 'Preparing the file…',
            failed: 'The file could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      {table ? (
        <Card>
          <div className="ep-strength__head">
            <div>
              <h2 className="ep-approvals__title">{table.title}</h2>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {table.subtitle} · {table.meta.students} students · {table.meta.filters.join('; ')}
              </p>
            </div>
            <div className="ep-strength__downloads">
              {(['xlsx', 'pdf'] as const).map((f) => (
                <form key={f} action={exportStrength}>
                  <input type="hidden" name="query" value={`${q.toString()}&run=1`} />
                  <input type="hidden" name="format" value={f} />
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    {f === 'xlsx' ? 'Excel' : 'PDF'}
                  </button>
                </form>
              ))}
            </div>
          </div>
          <div className="ep-table-wrap ep-strength__wrap">
            <table className="ep-strength__table">
              <caption className="ep-sr-only">{table.title}</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={twoRows ? 2 : 1}>
                    Sr#
                  </th>
                  <th scope="col" rowSpan={twoRows ? 2 : 1} className="ep-strength__cls">
                    Class
                  </th>
                  {twoRows
                    ? groups.map((g, gi) =>
                        g.label ? (
                          <th key={`${g.label}-${String(gi)}`} scope="colgroup" colSpan={g.span}>
                            {g.label}
                          </th>
                        ) : (
                          <th key={`x-${String(gi)}`} scope="col" rowSpan={2}>
                            {
                              table!.columns[groups.slice(0, gi).reduce((n, x) => n + x.span, 0)]!
                                .label
                            }
                          </th>
                        ),
                      )
                    : table.columns.map((c) => (
                        <th key={c.key} scope="col">
                          {c.label}
                        </th>
                      ))}
                </tr>
                {twoRows ? (
                  <tr>
                    {table.columns
                      .filter((c) => c.group)
                      .map((c) => (
                        <th key={c.key} scope="col" className="ep-strength__sub">
                          <span className="ep-sr-only">{c.group} </span>
                          {c.label}
                        </th>
                      ))}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {table.rows.map((row, i) => {
                  if (row.kind === 'row') sr += 1;
                  return (
                    <tr key={`${row.label}-${String(i)}`} data-kind={row.kind}>
                      <td>{row.kind === 'row' ? sr : ''}</td>
                      <th scope="row" className="ep-strength__cls">
                        {row.label}
                      </th>
                      {table!.columns.map((c) => {
                        const n = row.values[c.key] ?? 0;
                        return (
                          <td key={c.key}>
                            {n > 0 ? (
                              <a
                                href={studentsHref(row, c.key)}
                                aria-label={`${String(n)} students, ${row.label}, ${c.group ? `${c.group} ` : ''}${c.label}`}
                              >
                                {n}
                              </a>
                            ) : (
                              0
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="ep-field__help">Click a number to see the students behind it.</p>
        </Card>
      ) : !error && sp.run === '1' ? (
        <div className="ep-alert ep-alert--warning" role="status">
          {report === 'age'
            ? 'Enter the as-on date, then show the report.'
            : 'Choose the discount, then show the report.'}
        </div>
      ) : null}
    </>
  );
}
