import {
  analyse,
  bestFive,
  categoryOf,
  DEFAULT_BOARD_RULES,
  headlineOf,
  subjectFigures,
  type AnCandidate,
  type AnInput,
  type AnSubject,
  type BoardRules,
} from './board-analysis';

// Every name, roll number and mark here is made up.
const SUBJECTS: AnSubject[] = [
  { code: '184', name: 'English Language and Literature', kind: 'language' },
  { code: '085', name: 'Hindi Course-B', kind: 'language' },
  { code: '041', name: 'Mathematics (Standard)', kind: 'main' },
  { code: '086', name: 'Science', kind: 'main' },
  { code: '087', name: 'Social Science', kind: 'main' },
  { code: '165', name: 'Computer Applications', kind: 'skill' },
  { code: '049', name: 'Painting', kind: 'additional' },
];
const kind = (c: string) => SUBJECTS.find((s) => s.code === c)?.kind;
const nameOf = (c: string) => SUBJECTS.find((s) => s.code === c)?.name ?? '';

let roll = 30000000;
function cand(
  marks: Array<[string, number | null, string?]>,
  more: Partial<AnCandidate> = {},
): AnCandidate {
  roll += 1;
  return {
    roll: String(roll),
    name: `CANDIDATE ${String(roll).slice(-3)}`,
    sex: 'F',
    result: 'PASS',
    compartment: [],
    section: 'A',
    stream: null,
    category: null,
    ews: false,
    cwsn: false,
    boarder: false,
    staffWard: false,
    marks: marks.map(([code, m, grade]) => ({ code, marks: m, grade: grade ?? null })),
    ...more,
  };
}
const input = (candidates: AnCandidate[], more: Partial<AnInput> = {}): AnInput => ({
  classLabel: 'X',
  examYear: 2026,
  rules: DEFAULT_BOARD_RULES,
  candidates,
  subjects: SUBJECTS,
  teacher: () => null,
  history: [],
  lastYear: null,
  ...more,
});
const table = (a: ReturnType<typeof analyse>, no: number, key: string) =>
  a.annexures[no - 1]!.tables.find((t) => t.key === key)!;

describe('CBSE board result annexures (docs/design/88, phase C)', () => {
  it('chooses the best five by the rule: best language + four, English + four, any five', () => {
    const c = cand([
      ['184', 60],
      ['085', 70],
      ['041', 95],
      ['086', 90],
      ['087', 85],
      ['165', 99],
      ['049', 88],
    ]);
    const of = (rule: BoardRules['bestFive']) => bestFive(c, kind, rule, nameOf);
    // the best language (Hindi 70) and the best four others (99, 95, 90, 88)
    expect(of('language-plus-four')).toMatchObject({ total: 442, percent: 88.4 });
    expect(of('language-plus-four').codes).toEqual(['085', '165', '041', '086', '049']);
    expect(of('english-plus-four').total).toBe(432);
    expect(of('any-five').total).toBe(457);
  });

  it('counts registered, appeared, absent, failures, compartments and the best-five bands', () => {
    const all = [
      cand([
        ['184', 95],
        ['085', 92],
        ['041', 90],
        ['086', 91],
        ['087', 93],
      ]),
      cand(
        [
          ['184', 80],
          ['085', 75],
          ['041', 75],
          ['086', 70],
          ['087', 75],
        ],
        { sex: 'M' },
      ),
      cand(
        [
          ['184', 40],
          ['085', 30],
          ['041', 45],
          ['086', 50],
          ['087', 35],
        ],
        { sex: 'M', result: 'COMP', compartment: ['085'] },
      ),
      // absent throughout: registered, not appeared
      cand(
        [
          ['184', null],
          ['085', null],
        ],
        { result: 'ABST' },
      ),
    ];
    const h = headlineOf(all, SUBJECTS, DEFAULT_BOARD_RULES);
    expect(h).toMatchObject({
      registered: 4,
      appeared: 3,
      absent: 1,
      failures: 0,
      compartments: 1,
      passed: 2,
      passPct: 66.67,
      n90: 1,
      n75: 2,
      highest: 92.2,
      lowest: 40,
    });
    const o = table(analyse(input(all)), 2, 'overall').rows[0]!;
    expect(o).toMatchObject({
      enrolled: 4,
      absent: 1,
      appeared: 3,
      compNo: 1,
      passNo: 2,
      boysNo: 1,
      boysPct: 50,
      girlsPct: 100,
      // ≥90, 75–89.9, 60–74.9, 45–59.9, <45
      b0No: 1,
      b1No: 1,
      b2No: 0,
      b3No: 0,
      b4No: 1,
    });
  });

  it("subjects: a compartment subject is no pass, marks under the pass marks a failure; grades by the school's scale or as printed", () => {
    const all = [
      cand([
        ['184', 91, 'A2'],
        ['041', 81, 'B1'],
      ]),
      cand([
        ['184', 33, 'D2'],
        ['041', 32, 'E'],
      ]),
      cand(
        [
          ['184', 50, 'D1'],
          ['041', 40, 'C2'],
        ],
        { result: 'COMP', compartment: ['184'] },
      ),
      // sat the examination, absent in Mathematics
      cand([
        ['184', 100, 'A1'],
        ['041', null],
      ]),
      // absent throughout: in no subject's count
      cand([['184', null]], { result: 'ABST' }),
    ];
    const a = analyse(input(all));
    const s4 = table(a, 4, 'summary');
    const eng = s4.rows.find((r) => r.subject === '184-English Language and Literature')!;
    expect(eng).toMatchObject({
      total: 4,
      appeared: 4,
      absent: 0,
      pass: 3,
      fail: 1,
      max: 100,
      min: 33,
      gA1: 2,
      gC1: 0,
      gD: 1,
      dist: 2,
    });
    const maths = s4.rows.find((r) => String(r.subject).startsWith('041'))!;
    // 81 → A2, 40 → D, 32 → E (not a division)
    expect(maths).toMatchObject({
      total: 4,
      appeared: 3,
      absent: 1,
      pass: 2,
      fail: 1,
      gA2: 1,
      gD: 1,
      gE: 1,
      graded: 2,
    });
    const sub = table(a, 2, 'subjects').rows.find((r) => r.subject === nameOf('184'))!;
    expect(sub).toMatchObject({ compNo: 1, failNo: 0, passNo: 3, hundreds: 1 });
    // as printed: A2, D2 → D, D1 → D, A1
    const printed = analyse(input(all, { rules: { ...DEFAULT_BOARD_RULES, grades: 'printed' } }));
    expect(
      table(printed, 4, 'summary').rows.find((r) => String(r.subject).startsWith('184')),
    ).toMatchObject({ gA1: 1, gA2: 1, gD: 2 });
  });

  it('groups by EWS, category, boarders and staff wards; reads SC/ST/OBC whatever the spelling', () => {
    const five = (m: number): Array<[string, number]> => [
      ['184', m],
      ['085', m],
      ['041', m],
      ['086', m],
      ['087', m],
    ];
    const all = [
      cand(five(80), { ews: true, category: 'OBC/' }),
      cand(five(70), { category: 'sc', staffWard: true }),
      cand(five(60), { boarder: true, cwsn: true }),
    ];
    expect(categoryOf(all[0]!)).toBe('OBC');
    expect(categoryOf(all[1]!)).toBe('SC');
    expect(categoryOf(all[2]!)).toBe('GEN');
    const g = table(analyse(input(all)), 3, 'groups').rows;
    const at = (label: string) => g.find((r) => r.label === label)!;
    expect(at('EWS')).toMatchObject({ enrolled: 1, avg: 80 });
    expect(at('Non-EWS')).toMatchObject({ enrolled: 2, avg: 65 });
    expect(at('Boarders').enrolled).toBe(1);
    expect(at('Day scholars').enrolled).toBe(2);
    expect(at('Staff wards').enrolled).toBe(1);
    expect(at('OBC').enrolled).toBe(1);
    expect(at('SC').enrolled).toBe(1);
    expect(at('General').enrolled).toBe(1);
    expect(at('CWSN').enrolled).toBe(1);
  });

  it('sections with their teachers (a section split by roll number), the all-sections line, ACR bands by teacher', () => {
    const all = [
      cand([['184', 95]], { section: 'A' }),
      cand([['184', 85]], { section: 'A' }),
      cand([['184', 35]], { section: 'B' }),
    ];
    const split = all[1]!.roll;
    const a = analyse(
      input(all, {
        teacher: (section, code, r) =>
          code !== '184' ? null : section === 'B' ? 'Tara T' : r === split ? 'Omar O' : 'Tara T',
      }),
    );
    const a7 = a.annexures[6]!.tables;
    expect(a7.map((t) => t.title)).toEqual(['Section A', 'Section B']);
    expect(a7[0]!.rows.map((r) => [r.teacher, r.total, r.b0, r.b1])).toEqual([
      ['Omar O', 1, 0, 1],
      ['Tara T', 1, 1, 0],
    ]);
    const a8 = a.annexures[7]!.tables[0]!;
    expect(a8.rows.at(-1)).toMatchObject({
      section: 'All',
      total: 3,
      highest: 95,
      lowest: 35,
      avg: 71.67,
    });
    expect(a8.strong).toEqual([3]);
    const byT = table(a, 10, 'teachers').rows;
    expect(byT.find((r) => r.teacher === 'Tara T')).toMatchObject({
      sections: 'A, B',
      total: 2,
      b2: 1,
      b8: 1,
    });
  });

  it('five years in Annexure 1 and the year before in Annexure 5', () => {
    const now = [
      cand([
        ['184', 90],
        ['085', 80],
        ['041', 70],
        ['086', 60],
        ['087', 50],
      ]),
    ];
    const before = [
      cand([
        ['184', 80],
        ['085', 70],
        ['041', 60],
        ['086', 50],
        ['087', 40],
      ]),
    ];
    const a = analyse(
      input(now, {
        history: [{ examYear: 2025, appeared: 1, pct90: 0, pct75: 0, aggregate: 60 }],
        lastYear: subjectFigures(before, DEFAULT_BOARD_RULES),
      }),
    );
    const years = table(a, 1, 'years');
    expect(years.columns.map((c) => c.label)).toEqual(['Figure', '2024-25', '2025-26']);
    expect(years.rows[3]).toMatchObject({ y2025: 60, y2026: 70 });
    const eng = table(a, 5, 'compare').rows.find((r) => r.subject === nameOf('184'))!;
    // 80 (B1) → 90 (A2): an A grade now, none before (+100 points of the share); a distinction both years
    expect(eng).toMatchObject({
      appL: 1,
      appN: 1,
      aL: 0,
      aN: 1,
      aDiff: 100,
      distL: 1,
      distN: 1,
      avgL: 80,
      avgN: 90,
      avgDiff: 10,
    });
    const maths = table(a, 5, 'compare').rows.find((r) => r.subject === nameOf('041'))!;
    expect(maths).toMatchObject({ distL: 0, distN: 0, aL: 0, aN: 0 });
    // the toppers: one candidate, the best five
    expect(table(a, 1, 'toppers').rows).toEqual([
      expect.objectContaining({ rank: 1, total: 350, pct: 70 }),
    ]);
  });
});
