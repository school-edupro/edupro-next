import { ApiError } from '@edupro/bff';
import { Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';

type Cell = string | number | null;
interface Table {
  key: string;
  title: string;
  columns: Array<{ key: string; label: string; num?: boolean }>;
  rows: Array<Record<string, Cell>>;
}
interface Mine {
  employee: { id: string; name: string } | null;
  classes: Array<{
    classLabel: 'X' | 'XII';
    examYear: number;
    years: number[];
    students: number;
    tables: Table[];
  }>;
}
type Row = Record<string, Cell> & { __i: number };

const yearLabel = (y: number) => `${String(y - 1)}-${String(y).slice(2)}`;

/**
 * My board results in the staff app (docs/design/88, phase D): for each class with a saved CBSE result, the sections
 * and subjects I taught — the section-wise figures with the Performance Index, the ACR bands, and my students' marks.
 * Nothing of other teachers' sections.
 */
export default async function MyBoardResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ examYear?: string }>;
}) {
  const sp = await searchParams;
  let d: Mine | null = null;
  try {
    d = await bff.api.fetch<Mine>(
      `/exams/board-results/mine${/^\d{4}$/.test(sp.examYear ?? '') ? `?examYear=${sp.examYear!}` : ''}`,
    );
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) throw e;
  }
  const years = [...new Set((d?.classes ?? []).flatMap((c) => c.years))].sort((a, b) => b - a);

  return (
    <>
      <PageHeader
        kicker="Exams"
        title="My board results"
        description="CBSE Class X and XII results of the sections and subjects you taught: the section-wise figures, the Performance Index (PI), the bands your ACR uses, and your students' marks."
      />
      {years.length > 1 ? (
        <nav
          aria-label="Examination"
          className="ep-field__help"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {'Examination: '}
          {years.map((y, i) => (
            <span key={y}>
              {i ? ' · ' : ''}
              <a
                href={`/my-board-results?examYear=${String(y)}`}
                style={{ textDecoration: 'underline' }}
              >
                {`${String(y)} (${yearLabel(y)})`}
              </a>
            </span>
          ))}
        </nav>
      ) : null}
      {!d?.employee ? (
        <Card>
          <p style={{ margin: 0 }}>
            Your sign-in is not linked to a staff record, so there is nothing to show. Ask the
            office to link it.
          </p>
        </Card>
      ) : !d.classes.length ? (
        <Card>
          <p style={{ margin: 0 }}>
            No saved CBSE result has a section and subject of yours yet. The exam office saves the
            result file; the sections come from your subject-teacher assignments (or the exam
            office&apos;s Teachers list).
          </p>
        </Card>
      ) : (
        d.classes.map((c) => {
          const sections = c.tables.find((t) => t.key === 'sections');
          const pis = (sections?.rows ?? [])
            .map((r) => Number(r.pi))
            .filter((x) => Number.isFinite(x));
          return (
            <section
              key={c.classLabel}
              aria-label={`Class ${c.classLabel}`}
              style={{
                display: 'grid',
                gap: 'var(--sp-4)',
                gridTemplateColumns: 'minmax(0, 1fr)',
                marginBottom: 'var(--sp-5)',
              }}
            >
              <h2 className="ep-card__title" style={{ margin: 0 }}>
                {`Class ${c.classLabel} · ${String(c.examYear)} (${yearLabel(c.examYear)})`}
              </h2>
              <div className="ep-dash-kpis">
                <KpiTile label="Sections and subjects" value={String(sections?.rows.length ?? 0)} />
                <KpiTile label="Students" value={String(c.students)} />
                <KpiTile
                  label="Best PI"
                  value={pis.length ? String(Math.max(...pis)) : '—'}
                  hint="of your sections"
                />
              </div>
              {c.tables.map((t) => {
                const rows: Row[] = t.rows.map((r, i) => ({ ...r, __i: i }));
                return (
                  <Card key={t.key} title={t.title}>
                    <DataTable<Row>
                      caption={`${t.title}, Class ${c.classLabel}`}
                      density="dense"
                      columns={t.columns.map((col) => ({
                        key: col.key,
                        header: col.label,
                        numeric: Boolean(col.num),
                        render: (r: Row) => {
                          const v = r[col.key];
                          return v === null || v === undefined ? '' : String(v);
                        },
                      }))}
                      rows={rows}
                      rowKey={(r) => String(r.__i)}
                      emptyTitle="None"
                    />
                  </Card>
                );
              })}
            </section>
          );
        })
      )}
    </>
  );
}
