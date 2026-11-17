import { Badge, Card, DataTable } from '@edupro/ui';
import { yearLabel, type BoardStudentResult } from '@/lib/board-results';

type Subject = BoardStudentResult['subjects'][number];

/**
 * A student's CBSE board results on the student's record (docs/design/88, phase D): each saved year — the result,
 * the best five, every subject's marks and grade as CBSE printed them.
 */
export function BoardResultCard({ rows }: { rows: BoardStudentResult[] }) {
  return (
    <Card title="Board results">
      <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {rows.map((r) => (
          <section
            key={`${r.classLabel}-${String(r.examYear)}`}
            aria-label={`Class ${r.classLabel} ${String(r.examYear)}`}
          >
            <p style={{ margin: '0 0 var(--sp-2)' }}>
              <strong>{`Class ${r.classLabel} · ${String(r.examYear)} (${yearLabel(r.examYear)})`}</strong>
              {` · board roll no ${r.roll} · `}
              <Badge
                tone={r.result === 'PASS' ? 'success' : r.result === 'COMP' ? 'warning' : 'neutral'}
              >
                {r.result ?? '—'}
              </Badge>
              {r.bestFive
                ? ` · best five ${String(r.bestFive.total)} (${String(r.bestFive.percent)}%)`
                : ''}
              {r.compartment.length
                ? ` · compartment: ${r.compartment.map((x) => x.name).join(', ')}`
                : ''}
            </p>
            <DataTable<Subject>
              caption={`Class ${r.classLabel} ${String(r.examYear)} subjects`}
              density="dense"
              columns={[
                { key: 'c', header: 'Code', render: (s) => s.code },
                { key: 'n', header: 'Subject', render: (s) => s.name },
                {
                  key: 'm',
                  header: 'Marks',
                  numeric: true,
                  render: (s) => (s.marks === null ? 'Absent' : String(s.marks)),
                },
                { key: 'g', header: 'Grade', render: (s) => s.grade ?? '—' },
                {
                  key: 'b',
                  header: 'In best five',
                  render: (s) => (s.inBestFive ? 'Yes' : ''),
                },
              ]}
              rows={r.subjects}
              rowKey={(s) => s.code}
            />
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {`Best five: ${r.rule}. `}
              <a
                href={`/exams/board-results?tab=analysis&classLabel=${r.classLabel}&examYear=${String(r.examYear)}`}
                style={{ textDecoration: 'underline' }}
              >
                The class&apos;s analysis
              </a>
            </p>
          </section>
        ))}
      </div>
    </Card>
  );
}
