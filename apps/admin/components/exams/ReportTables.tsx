import { ViewDownload } from '@/components/admissions/ViewDownload';

type Cell = string | number | null;
export interface ExamReport {
  kind: string;
  title: string;
  subtitle: string[];
  tables: Array<{
    title?: string;
    columns: Array<{ key: string; label: string; right?: boolean; group?: string }>;
    rows: Cell[][];
    shade?: Record<string, 'heading' | 'subtotal'>;
  }>;
}

/**
 * An exam analysis's tables (docs/design/65 part 6): a heading row across the table, a summary line
 * in bold; the Excel download and the PDF's View / Download over them.
 */
export function ReportTables({
  report,
  files,
}: {
  report: ExamReport;
  /** the file route without the format: /api/exam-report/<id>/<kind> and the filters segment */
  files: { base: string; q: string };
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${files.base}/xlsx/${files.q}`}>
          Excel
        </a>
        <span>
          PDF{' '}
          <ViewDownload href={`${files.base}/pdf/${files.q}`} what={`the PDF of ${report.title}`} />
        </span>
      </div>
      {report.tables.map((t, ti) => {
        const groups = t.columns.some((c) => c.group);
        return (
          <section key={ti} style={{ marginBottom: 'var(--sp-4)' }}>
            {t.title ? <h3 className="ep-cdash__h3">{t.title}</h3> : null}
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t.title ?? report.title}
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{t.title ?? report.title}</caption>
                <thead>
                  {groups ? (
                    <tr>
                      {t.columns.map((c, i) =>
                        c.group && t.columns[i - 1]?.group === c.group ? null : (
                          <th
                            key={c.key}
                            scope={c.group ? 'colgroup' : 'col'}
                            colSpan={
                              c.group ? t.columns.filter((x) => x.group === c.group).length : 1
                            }
                          >
                            {c.group ?? ''}
                          </th>
                        ),
                      )}
                    </tr>
                  ) : null}
                  <tr>
                    {t.columns.map((c) => (
                      <th key={c.key} scope="col" className={c.right ? 'is-numeric' : undefined}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.length ? (
                    t.rows.map((r, i) =>
                      t.shade?.[String(i)] === 'heading' ? (
                        <tr key={i}>
                          <th scope="rowgroup" colSpan={t.columns.length}>
                            {r.find((v) => v !== null && v !== '') ?? ''}
                          </th>
                        </tr>
                      ) : (
                        <tr
                          key={i}
                          style={
                            t.shade?.[String(i)] === 'subtotal' ? { fontWeight: 600 } : undefined
                          }
                        >
                          {r.map((v, k) => (
                            <td key={k} className={t.columns[k]?.right ? 'is-numeric' : undefined}>
                              {v ?? ''}
                            </td>
                          ))}
                        </tr>
                      ),
                    )
                  ) : (
                    <tr>
                      <td colSpan={t.columns.length}>Nothing to show.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
