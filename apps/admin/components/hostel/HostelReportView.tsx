import { ReportColumns, type ChoiceColumn } from '@/components/fees/ReportColumns';
import { apiFetch, getMe } from '@/lib/api';
import {
  resetHostelColumns,
  saveHostelColumnsMine,
  saveHostelColumnsSchool,
} from '@/lib/hostel-report-actions';

export type HostelReportId = 'register' | 'occupancy' | 'withdrawals' | 'leave';
interface Report {
  title: string;
  columns: Array<{ key: string; label: string; group?: string; right?: boolean }>;
  rows: Array<{
    cells: Record<string, string | number | null>;
    studentId?: string | null;
    href: string | null;
  }>;
  total: number;
  choice: { columns: ChoiceColumn[]; source: 'user' | 'school' | 'all' };
  hidden: string[];
}

/**
 * A hostel register as a report (allotment register, occupancy, withdrawals, leave): the columns the user
 * chose (father, mother, guardian and the address among them), Excel and PDF of exactly that, and the
 * table. `query` holds the report's filters as the API reads them; `back` is this page with its filters.
 */
export async function HostelReportView({
  report,
  query,
  back,
}: {
  report: HostelReportId;
  query: URLSearchParams;
  back: string;
}) {
  const [me, r] = await Promise.all([
    getMe(),
    apiFetch<Report>(`/hostel/reports/${report}?${query.toString()}`),
  ]);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/hostel/report-file?${new URLSearchParams({ ...Object.fromEntries(query), report, format }).toString()}`;
  // a heading row over the grouped columns (Father, Mother, Guardian)
  const groups: Array<{ label: string; span: number }> = [];
  for (const c of r.columns) {
    const last = groups[groups.length - 1];
    if (last && c.group && last.label === c.group) last.span += 1;
    else groups.push({ label: c.group ?? '', span: 1 });
  }
  const anyGroup = r.columns.some((c) => c.group);
  return (
    <>
      <div
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <ReportColumns
          key={r.choice.columns.map((c) => `${c.key}${c.hidden ? '-' : '+'}`).join('')}
          report={report}
          back={back}
          columns={r.choice.columns}
          source={r.choice.source}
          canSetSchool={me.permissions.includes('hostel.setup.manage')}
          saveMine={saveHostelColumnsMine}
          saveSchool={saveHostelColumnsSchool}
          reset={resetHostelColumns}
        />
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
          Excel
        </a>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
          PDF
        </a>
        <span className="ep-field__help" style={{ alignSelf: 'center' }}>
          {r.total} record{r.total === 1 ? '' : 's'}
          {r.hidden.length ? ` · ${String(r.hidden.length)} column(s) left out` : ''}
        </span>
      </div>
      {r.rows.length ? (
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{r.title}</caption>
            <thead>
              {anyGroup ? (
                <tr>
                  {groups.map((g, i) => (
                    <th key={`${g.label}-${String(i)}`} colSpan={g.span} scope="colgroup">
                      {g.label}
                    </th>
                  ))}
                </tr>
              ) : null}
              <tr>
                {r.columns.map((c) => (
                  <th key={c.key} scope="col" style={c.right ? { textAlign: 'right' } : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={`${row.href ?? ''}-${String(i)}`}>
                  {r.columns.map((c) => {
                    const v = row.cells[c.key];
                    const text = v === null || v === undefined || v === '' ? '—' : String(v);
                    return (
                      <td key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>
                        {c.key === 'pupil' && row.href ? <a href={row.href}>{text}</a> : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-muted">Nothing matches these filters.</p>
      )}
    </>
  );
}
