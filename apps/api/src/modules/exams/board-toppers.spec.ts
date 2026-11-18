import { DEFAULT_BOARD_RULES, type AnCandidate, type AnSubject } from './board-analysis';
import { toppersReport, type ToppersOptions } from './board-toppers';

// Every name, roll number and mark here is made up.
const SUBJECTS: AnSubject[] = [
  { code: '184', name: 'English Language and Literature', kind: 'language' },
  { code: '085', name: 'Hindi Course-B', kind: 'language' },
  { code: '041', name: 'Mathematics (Standard)', kind: 'main' },
  { code: '086', name: 'Science', kind: 'main' },
  { code: '087', name: 'Social Science', kind: 'main' },
  { code: '500', name: 'Work Experience', kind: 'internal' },
];
const cand = (roll: string, marks: number[], more: Partial<AnCandidate> = {}): AnCandidate => ({
  roll,
  name: `CANDIDATE ${roll.slice(-2)}`,
  sex: 'F',
  result: 'PASS',
  compartment: [],
  section: 'A',
  stream: null,
  category: null,
  ews: null,
  cwsn: null,
  boarder: null,
  staffWard: null,
  marks: [
    ...['184', '085', '041', '086', '087']
      .slice(0, marks.length)
      .map((code, i) => ({ code, marks: marks[i]!, grade: 'A1' })),
    { code: '500', marks: null, grade: 'A' },
  ],
  ...more,
});

const NOW = [
  cand('41000001', [98, 95, 96, 98, 100]), // 487 · 97.4
  cand('41000002', [99, 95, 96, 98, 99]), // 487 · 97.4
  cand('41000003', [95, 95, 98, 97, 99], { section: 'B', sex: 'M' }), // 484 · 96.8
  cand('41000004', [97, 95, 95, 97, 99], { section: 'B' }), // 483 · 96.6
  cand('41000005', [90, 85, 80, 88, 92], { sex: 'M' }), // 435 · 87
  cand('41000006', [40, 33, 45, 50, 35], { section: 'B', result: 'COMP' }), // 203 · 40.6
  { ...cand('41000007', []), result: 'ABST' },
];
const BEFORE = [
  cand('31000001', [96, 95, 96, 98, 100]), // 485 · 97
  cand('31000002', [80, 75, 76, 78, 79]), // 388 · 77.6
];
const opts = (more: Partial<ToppersOptions> = {}): ToppersOptions => ({
  method: 'best5',
  gender: 'all',
  show: 'both',
  top: 2,
  low: 0,
  ...more,
});

describe('the Topper Report (docs/design/88)', () => {
  it('lists the top ranks with ties (dense), the class rank beside a section rank, the lowest first', () => {
    const r = toppersReport(
      [{ examYear: 2026, candidates: NOW }],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      opts(),
    );
    const top = r.overall!.lists[0]!;
    expect(top.kind).toBe('top');
    // the top two ranks hold three students: two share the first
    expect(top.rows.map((x) => [x.roll.slice(-1), x.rank, x.pct])).toEqual([
      ['1', 1, 97.4],
      ['2', 1, 97.4],
      ['3', 2, 96.8],
    ]);
    expect(r.overall!.appeared).toBe(6);
    expect(r.overall!.max).toBe(500);
    // no class rank when the whole class is shown
    expect(top.rows[0]!.classRank).toBeNull();

    const b = toppersReport([{ examYear: 2026, candidates: NOW }], SUBJECTS, DEFAULT_BOARD_RULES, {
      ...opts({ section: 'B', low: 1, show: 'overall' }),
    });
    expect(b.subjects).toEqual([]);
    const [secTop, secLow] = b.overall!.lists;
    // ranked within section B, the class rank kept
    expect(secTop!.rows.map((x) => [x.roll.slice(-1), x.rank, x.classRank])).toEqual([
      ['3', 1, 2],
      ['4', 2, 3],
    ]);
    expect(secLow!.kind).toBe('low');
    expect(secLow!.rows.map((x) => [x.roll.slice(-1), x.rank])).toEqual([['6', 3]]);
  });

  it('subject toppers by marks (internal subjects left out), the chosen subjects, a percentage list', () => {
    const r = toppersReport([{ examYear: 2026, candidates: NOW }], SUBJECTS, DEFAULT_BOARD_RULES, {
      ...opts({ show: 'subjects', top: 1, codes: ['184', '087'], pctOp: 'gte', pct: 99 }),
    });
    expect(r.overall).toBeNull();
    expect(r.subjects.map((s) => s.code)).toEqual(['184', '087']);
    const eng = r.subjects[0]!;
    expect(eng.appeared).toBe(6);
    expect(eng.lists[0]!.rows.map((x) => [x.roll.slice(-1), x.marks, x.rank])).toEqual([
      ['2', 99, 1],
    ]);
    // at or above 99 in Social Science: three students, by rank
    const sst = r.subjects[1]!.lists.find((l) => l.kind === 'pct')!;
    expect(sst.rows.map((x) => [x.roll.slice(-1), x.marks])).toEqual([
      ['1', 100],
      ['2', 99],
      ['3', 99],
      ['4', 99],
    ]);
    const all = toppersReport(
      [{ examYear: 2026, candidates: NOW }],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      opts(),
    );
    expect(all.subjects.map((s) => s.code)).toEqual(['184', '085', '041', '086', '087']);
  });

  it('boys only, and the years compared in figures (oldest first)', () => {
    const boys = toppersReport(
      [
        { examYear: 2026, candidates: NOW },
        { examYear: 2025, candidates: BEFORE },
      ],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      opts({ gender: 'M', show: 'overall' }),
    );
    expect(
      boys.overall!.lists[0]!.rows.map((x) => [x.roll.slice(-1), x.rank, x.classRank]),
    ).toEqual([
      ['3', 1, 2],
      ['5', 2, 4],
    ]);
    const all = toppersReport(
      [
        { examYear: 2026, candidates: NOW },
        { examYear: 2025, candidates: BEFORE },
      ],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      opts({ show: 'overall' }),
    );
    expect(
      all.years.map((y) => [y.label, y.appeared, y.highest, y.atFirst, y.cutoff, y.inTop, y.pct95]),
    ).toEqual([
      ['2024-25', 2, 97, 1, 77.6, 2, 1],
      ['2025-26', 6, 97.4, 2, 96.8, 3, 4],
    ]);
  });
});
