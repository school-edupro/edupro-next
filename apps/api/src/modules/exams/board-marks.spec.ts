import { DEFAULT_BOARD_RULES, type AnCandidate, type AnSubject } from './board-analysis';
import { filterMarks, marksRows } from './board-marks';

// Every name, roll number and mark here is made up.
const SUBJECTS: AnSubject[] = [
  { code: '184', name: 'English Language and Literature', kind: 'language' },
  { code: '085', name: 'Hindi Course-B', kind: 'language' },
  { code: '041', name: 'Mathematics (Standard)', kind: 'main' },
  { code: '086', name: 'Science', kind: 'main' },
  { code: '087', name: 'Social Science', kind: 'main' },
  { code: '417', name: 'Artificial Intelligence', kind: 'skill' },
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
  marks: ['184', '085', '041', '086', '087', '417']
    .slice(0, marks.length)
    .map((code, i) => ({ code, marks: marks[i]!, grade: 'A1' })),
  ...more,
});

describe('the Results tab: candidate-wise marks (docs/design/88)', () => {
  const all = [
    cand('31000001', [98, 95, 96, 98, 100]), // 487
    cand('31000002', [97, 95, 95, 97, 99, 97]), // six subjects: the best five 485
    cand('31000003', [95, 95, 98, 97, 99]), // 484
    cand('31000004', [98, 95, 95, 97, 99], { section: 'B', sex: 'M' }), // 484
    cand('31000005', [96, 95, 95, 99, 99], { section: 'B' }), // 484
    cand('31000006', [99, 95, 95, 95, 99]), // 483
    cand('31000007', [40, 30, 45, 50, 35], { result: 'COMP', compartment: ['085'] }), // 200
    { ...cand('31000008', []), result: 'ABST', marks: [{ code: '184', marks: null, grade: null }] },
  ];

  it('ranks are dense: equal aggregates share a rank and the next one follows', () => {
    const rows = filterMarks(marksRows(all, SUBJECTS, DEFAULT_BOARD_RULES, 'best5'), {
      sort: 'rank',
    });
    expect(rows.map((r) => [r.roll.slice(-1), r.total, r.rank])).toEqual([
      ['1', 487, 1],
      ['2', 485, 2],
      ['3', 484, 3],
      ['4', 484, 3],
      ['5', 484, 3],
      ['6', 483, 4],
      ['7', 200, 5],
      ['8', null, null],
    ]);
    // the six-subject candidate: one subject not counted, the maximum 500
    const six = rows[1]!;
    expect(six.max).toBe(500);
    expect(six.subjects.filter((s) => !s.counted)).toHaveLength(1);
    expect(rows[6]!.compartment).toEqual([{ code: '085', name: 'Hindi Course-B' }]);
  });

  it('all subjects: the total of every subject over 100 a subject', () => {
    const rows = marksRows(all, SUBJECTS, DEFAULT_BOARD_RULES, 'all');
    const six = rows.find((r) => r.roll === '31000002')!;
    expect(six).toMatchObject({ total: 580, max: 600, percent: 96.67 });
    expect(six.subjects.every((s) => s.counted)).toBe(true);
    // ranked by the percentage when the maximums differ
    expect(six.rank).toBe(3);
  });

  it('filters: section, result, percentage band, search; sorting by roll, name or section', () => {
    const rows = marksRows(all, SUBJECTS, DEFAULT_BOARD_RULES, 'best5');
    const f = (x: Parameters<typeof filterMarks>[1]) =>
      filterMarks(rows, x).map((r) => r.roll.slice(-1));
    expect(f({ sort: 'rank', section: 'B' })).toEqual(['4', '5']);
    expect(f({ sort: 'rank', result: 'COMP' })).toEqual(['7']);
    expect(f({ sort: 'rank', band: 'below45' })).toEqual(['7']);
    expect(f({ sort: 'rank', band: '90' })).toHaveLength(6);
    expect(f({ sort: 'rank', q: '3100000' })).toHaveLength(8);
    expect(f({ sort: 'rank', q: 'candidate 05' })).toEqual(['5']);
    expect(f({ sort: 'section' }).slice(-2)).toEqual(['4', '5']);
    expect(f({ sort: 'roll' })[0]).toBe('1');
  });

  it('first five: the first five subjects as CBSE printed them, whatever their marks', () => {
    const rows = marksRows(all, SUBJECTS, DEFAULT_BOARD_RULES, 'first5');
    // six subjects 97, 95, 95, 97, 99, 97: the first five 483, not the best five 485
    const six = rows.find((r) => r.roll === '31000002')!;
    expect(six).toMatchObject({ total: 483, max: 500, percent: 96.6 });
    expect(six.subjects.filter((x) => !x.counted).map((x) => x.code)).toEqual(['417']);
  });
});
