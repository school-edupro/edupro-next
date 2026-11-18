import { PDFDocument } from 'pdf-lib';
import { resultChartsPdf } from './board-charts-pdf';
import type { ResultCharts } from './board-reports';

// made-up figures: three subjects, two years
const grades = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E1'];
const year = (label: string, counts: number[]) => {
  const appeared = counts.reduce((a, n) => a + n, 0);
  return {
    label,
    appeared,
    counts,
    pct: counts.map((n) => Math.round((n * 10000) / appeared) / 100),
  };
};
const subjects = [
  { code: '301', name: 'English Core' },
  { code: '041', name: 'Mathematics' },
  { code: '042', name: 'Physics' },
];
const charts: ResultCharts = {
  passTrend: {
    labels: ['2025-26', '2026-27'],
    series: [{ label: 'All', values: [94, 96.5] }],
  },
  grades,
  tones: ['success', 'success-soft', 'navy', 'navy-soft', 'cyan', 'cyan-soft', 'warning', 'danger'],
  gradeSpread: subjects.map((s, i) => ({ ...s, ...year('2026-27', [4 + i, 6, 8, 5, 4, 2, 1, i]) })),
  marks: subjects.map((s, i) => ({ ...s, values: [97 - i, 71.25, 30 + i] })),
  subjectYears: subjects.map((s, i) => ({
    ...s,
    series: [
      year('2025-26', [3, 5, 9, 6, 4, 3, 1, 0]),
      year('2026-27', [4 + i, 6, 8, 5, 4, 2, 1, i]),
    ],
  })),
};
const head = {
  school: 'Sample School',
  address: 'Sample Road',
  logo: null,
  generatedOn: '18-11-2026 10:00 AM',
  by: 'Test Maker',
  title: 'CBSE AISSCE result (Class XII) 2026-27 · result analysis',
  scope: 'all students · all subjects · all results',
};

describe('the Result Analysis graphs PDF', () => {
  it('draws the four charts with their numbers, the subjects across the years two a page, and the boxes', async () => {
    const pdf = await PDFDocument.load(await resultChartsPdf(charts, head));
    // the pass, grade and marks charts of three subjects on the first page, then the subjects two a page
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toContain('graphs');
  });

  it('draws one subject when the filter names it, and an empty year without failing', async () => {
    const one: ResultCharts = {
      ...charts,
      gradeSpread: charts.gradeSpread.slice(0, 1),
      marks: charts.marks.slice(0, 1),
      subjectYears: [
        {
          ...subjects[0]!,
          series: [
            { label: '2025-26', appeared: 0, counts: Array(8).fill(0), pct: Array(8).fill(0) },
          ],
        },
      ],
    };
    const pdf = await PDFDocument.load(await resultChartsPdf(one, head, { code: '301' }));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
