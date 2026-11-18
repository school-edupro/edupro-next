import { DEFAULT_BOARD_RULES, type AnCandidate, type AnSubject } from './board-analysis';
import {
  rangeOverall,
  rangeSubjectSummary,
  resultAnalysisTable,
  resultCharts,
  subjectPerformance,
  teacherAnalysisTable,
  type TeachersOf,
} from './board-reports';

// Every roll number and mark here is made up.
const SUBJECTS: AnSubject[] = [
  { code: '184', name: 'English Language and Literature', kind: 'language' },
  { code: '417', name: 'Artificial Intelligence', kind: 'skill' },
  { code: '500', name: 'Work Experience', kind: 'internal' },
];
let n = 0;
const cand = (
  sex: 'M' | 'F',
  marks: Array<[string, number | null]>,
  more: Partial<AnCandidate> = {},
): AnCandidate => ({
  roll: String(32000000 + (n += 1)),
  name: null,
  sex,
  result: 'PASS',
  compartment: [],
  section: 'A',
  stream: null,
  category: null,
  ews: null,
  cwsn: null,
  boarder: null,
  staffWard: null,
  marks: marks.map(([code, m]) => ({ code, marks: m, grade: null })),
  ...more,
});

describe('Range Wise Subject Summary (docs/design/88)', () => {
  const now = [
    cand('F', [
      ['184', 95],
      ['417', 80],
      ['500', null],
    ]),
    cand('M', [
      ['184', 70],
      ['417', null],
    ]), // absent in AI
    cand('F', [['184', 50]]),
    cand('M', [['184', 40]], { result: 'COMP', compartment: ['184'] }),
    cand('M', [['184', 30]]),
  ];
  const before = [cand('F', [['184', 88]]), cand('M', [['417', 100]])];

  it("each subject's 21 figures; divisions do not overlap and add up to those who appeared", () => {
    const r = rangeSubjectSummary(
      [
        { examYear: 2026, candidates: now },
        { examYear: 2025, candidates: before },
      ],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      { gender: 'all' },
    );
    expect(r.years).toEqual([2025, 2026]);
    // alphabetical, the internal subject left out
    expect(r.blocks.map((b) => b.code)).toEqual(['417', '184']);
    const eng = r.blocks.find((b) => b.code === '184')!;
    expect(eng.rows).toHaveLength(21);
    const v = (key: string) => eng.rows.find((x) => x.key === key)!.values['2026']!;
    expect(v('total')).toEqual({ count: 5, pct: null });
    expect(v('appeared').count).toBe(5);
    // 40 is a compartment, 30 a failure
    expect(v('pass')).toEqual({ count: 3, pct: 60 });
    expect(v('fail')).toEqual({ count: 1, pct: 20 });
    expect(v('comp')).toEqual({ count: 1, pct: 20 });
    const div = ['distinction', 'first', 'second', 'third'].map((k) => v(k).count);
    expect(div).toEqual([1, 1, 1, 1]); // 95; 70; 50; 40 (30 is in none)
    expect(v('gA1').count).toBe(1);
    expect(v('gE1').count).toBe(1);
    expect(v('highest').count).toBe(95);
    expect(v('lowest').count).toBe(30);
    expect(v('average').count).toBe(57);
    expect(eng.rows.find((x) => x.key === 'gA1')!.label).toBe('A1 grade (91-100%)');
    // the earlier year
    expect(eng.rows.find((x) => x.key === 'appeared')!.values['2025']).toEqual({
      count: 1,
      pct: null,
    });
    const ai = r.blocks.find((b) => b.code === '417')!;
    expect(ai.rows.find((x) => x.key === 'absent')!.values['2026']!.count).toBe(1);
  });

  it('boys or girls only, and one subject', () => {
    const r = rangeSubjectSummary(
      [{ examYear: 2026, candidates: now }],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      {
        gender: 'F',
        code: '184',
      },
    );
    expect(r.blocks.map((b) => b.code)).toEqual(['184']);
    expect(r.blocks[0]!.rows.find((x) => x.key === 'appeared')!.values['2026']!.count).toBe(2);
    const printed = rangeSubjectSummary(
      [{ examYear: 2026, candidates: now }],
      SUBJECTS,
      { ...DEFAULT_BOARD_RULES, grades: 'printed' },
      { gender: 'all' },
    );
    expect(printed.blocks[1]!.rows.find((x) => x.key === 'gE1')!.label).toBe(
      'E1 grade (as printed)',
    );
  });

  it("Range Wise Summary: the class's result — results, divisions, ranges, highest, lowest, average", () => {
    const five = (m: number): Array<[string, number | null]> => [
      ['184', m],
      ['417', m],
    ];
    const SUBS: AnSubject[] = [
      { code: '184', name: 'English', kind: 'language' },
      { code: '417', name: 'AI', kind: 'skill' },
    ];
    // two subjects only: the best five is their total over 500 — the "all subjects" method is over 200
    const cands = [
      cand('F', five(95)),
      cand('M', five(85)),
      cand('F', five(62)),
      cand('M', five(50), { result: 'COMP', compartment: ['417'] }),
      { ...cand('M', [['184', null]]), result: 'ABST' },
    ];
    const r = rangeOverall([{ examYear: 2026, candidates: cands }], SUBS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      method: 'all',
    });
    expect(r.blocks).toHaveLength(1);
    const v = (key: string) => r.blocks[0]!.rows.find((x) => x.key === key)!.values['2026']!;
    expect(v('total')).toEqual({ count: 5, pct: null });
    expect(v('appeared')).toEqual({ count: 4, pct: null });
    expect(v('absent')).toEqual({ count: 1, pct: 20 }); // of all students
    expect(v('pass')).toEqual({ count: 3, pct: 75 }); // of those who appeared
    expect(v('comp')).toEqual({ count: 1, pct: 25 });
    expect(['distinction', 'first', 'second', 'third'].map((k) => v(k).count)).toEqual([
      2, 1, 1, 0,
    ]);
    // 90–100: 95; 80–89.99: 85; 60–69.99: 62; 50–59.99: 50
    expect(v('r0').count).toBe(1);
    expect(v('r1').count).toBe(1);
    expect(v('r3').count).toBe(1);
    expect(v('r4').count).toBe(1);
    expect(v('highest').count).toBe(95);
    expect(v('lowest').count).toBe(50);
    expect(v('average').count).toBe(73);
    // boys only
    const boys = rangeOverall([{ examYear: 2026, candidates: cands }], SUBS, DEFAULT_BOARD_RULES, {
      gender: 'M',
      method: 'all',
    });
    expect(boys.blocks[0]!.rows.find((x) => x.key === 'total')!.values['2026']!.count).toBe(3);
  });

  it('Subject Summary: a row a subject by boys and girls, the marks ranges whatever the grades, a total line', () => {
    const t = subjectPerformance(
      now,
      SUBJECTS,
      { ...DEFAULT_BOARD_RULES, grades: 'printed' },
      { gender: 'all' },
    );
    expect(t.rows.map((r) => r.subject)).toEqual(['English Lng & Lit', 'AI', 'Total']);
    expect(t.strong).toEqual([2]);
    const eng = t.rows[0]!;
    // 95 F, 70 M, 50 F, 40 M (compartment), 30 M (failure)
    expect(eng).toMatchObject({
      appeared: 5,
      boys: 3,
      girls: 2,
      failNo: 1,
      failPct: 20,
      compNo: 1,
      passNo: 3,
      boysPassNo: 1,
      boysPassPct: 33.33,
      girlsPassNo: 2,
      girlsPassPct: 100,
      avg: 57,
      avgGirls: 72.5,
      highest: 95,
    });
    // marks ranges, not printed grades: 95 girl → A1; 70 boy → B2 (61–70); 30 boy → E1
    expect([eng.r0G, eng.r3B, eng.r7B]).toEqual([1, 1, 1]);
    const total = t.rows[2]!;
    expect(total).toMatchObject({ appeared: 6, passNo: 4, highest: null });
    // girls only
    const girls = subjectPerformance(now, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'F',
      code: '184',
    });
    expect(girls.rows[0]).toMatchObject({ appeared: 2, boys: 0, girls: 2 });
  });

  it('Result Analysis: grades add up to those who appeared; boys vs girls as three rows; the result filter; charts', () => {
    const t = resultAnalysisTable(now, SUBJECTS, DEFAULT_BOARD_RULES, { gender: 'all' });
    const eng = t.rows.find((r) => r.code === '184')!;
    const grades = ['gA1', 'gA2', 'gB1', 'gB2', 'gC1', 'gC2', 'gD', 'gE1'].map((k) =>
      Number(eng[k]),
    );
    expect(grades.reduce((a, b) => a + b, 0)).toBe(eng.appeared);
    expect(eng).toMatchObject({
      total: 5,
      appeared: 5,
      absentNo: 0,
      passNo: 3,
      failNo: 1,
      compNo: 1,
      distNo: 1,
      firstNo: 1,
      secondNo: 1,
      thirdNo: 1,
    });
    // the AI absent in one: absent of all
    const ai = t.rows.find((r) => r.code === '417')!;
    expect(ai).toMatchObject({ total: 2, appeared: 1, absentNo: 1, absentPct: 50 });
    expect(t.columns.find((c) => c.key === 'gA1')!.label).toBe('A1 (91-100)');
    const both = resultAnalysisTable(now, SUBJECTS, DEFAULT_BOARD_RULES, { gender: 'both' });
    // two subjects × all/boys/girls, then three totals
    expect(both.rows.map((r) => r.subject)).toEqual([
      'English Lng & Lit · All',
      'English Lng & Lit · Boys',
      'English Lng & Lit · Girls',
      'AI · All',
      'AI · Boys',
      'AI · Girls',
      'Total · All',
      'Total · Boys',
      'Total · Girls',
    ]);
    expect(both.strong).toEqual([6, 7, 8]);
    const comp = resultAnalysisTable(now, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      result: 'COMP',
    });
    expect(comp.rows.find((r) => r.code === '184')).toMatchObject({ appeared: 1, compNo: 1 });
    const ch = resultCharts(
      [
        { examYear: 2026, candidates: now },
        { examYear: 2025, candidates: before },
      ],
      SUBJECTS,
      DEFAULT_BOARD_RULES,
      { gender: 'both' },
    );
    expect(ch.passTrend.labels).toEqual(['2024-25', '2025-26']);
    expect(ch.passTrend.series.map((x) => x.label)).toEqual(['All', 'Boys', 'Girls']);
    // 2026: 4 PASS of 5 appeared (the compartment is not a pass)
    expect(ch.passTrend.series[0]!.values[1]).toBe(80);
    expect(ch.marks.find((m) => m.code === '184')!.values).toEqual([95, 57, 30]);
    expect(ch.grades).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E1']);
    const g184 = ch.gradeSpread.find((g) => g.code === '184')!;
    expect(g184.counts).toHaveLength(8);
    expect(g184.counts.reduce((a, n) => a + n, 0)).toBe(g184.appeared);
    expect(g184.pct.reduce((a, n) => a + n, 0)).toBeCloseTo(100, 0);
    // every subject across the years, oldest first, each year its own share
    expect(ch.subjectYears.map((x) => x.code)).toEqual(ch.gradeSpread.map((x) => x.code));
    const y184 = ch.subjectYears.find((x) => x.code === '184')!;
    expect(y184.series.map((x) => x.label)).toEqual(['2024-25', '2025-26']);
    expect(y184.series[1]!.counts).toEqual(g184.counts);
    const one = resultCharts([{ examYear: 2026, candidates: now }], SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      code: '184',
    });
    expect(one.subjectYears.map((x) => x.code)).toEqual(['184']);
  });
});

describe('Teacher wise result analysis (docs/design/88)', () => {
  // English: A taught by a staff teacher (id 11); B shared by her and a name typed on the Teachers tab; AI: nobody set
  const rows = [
    cand(
      'F',
      [
        ['184', 95],
        ['417', 80],
      ],
      { section: 'A' },
    ),
    cand('M', [['184', 65]], { section: 'A' }),
    cand('F', [['184', 85]], { section: 'B' }),
    cand('M', [['184', 25]], { section: 'B' }),
  ];
  const ASHA = { id: '11', name: 'Asha Teacher' };
  const GUEST = { id: null, name: 'Guest Teacher' };
  const of: TeachersOf = (section, code) =>
    code !== '184' ? [] : section === 'A' ? [ASHA] : [ASHA, GUEST];

  it('a row a subject and section a teacher taught, her total, the PI and the class average; nobody set last', () => {
    const r = teacherAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, of, { gender: 'all' });
    expect(r.teachers).toEqual([
      { key: '11', name: 'Asha Teacher' },
      { key: 'n:Guest Teacher', name: 'Guest Teacher' },
      { key: 'none', name: 'No teacher set' },
    ]);
    const t = r.table;
    expect(t.rows.map((x) => [x.sno, x.teacher, x.code, x.section, x.appeared])).toEqual([
      [1, 'Asha Teacher', '184', 'A', 2],
      ['', '', '184', 'B', 2],
      ['', '', '', '', 4],
      [2, 'Guest Teacher', '184', 'B', 2],
      [3, 'No teacher set', '417', 'A', 1],
    ]);
    expect(t.strong).toEqual([2]);
    expect(t.rows[2]).toMatchObject({ subject: 'Total (Asha Teacher)', passNo: 3, failNo: 1 });
    // English over the class: (95 + 65 + 85 + 25) / 4 = 67.5; section A 80 (+12.5), B 55 (-12.5)
    expect(t.rows[0]).toMatchObject({ avg: 80, classAvg: 67.5, vsClass: 12.5 });
    expect(t.rows[1]).toMatchObject({ avg: 55, classAvg: 67.5, vsClass: -12.5 });
    expect(t.rows[1]!.subject).toBe('English Lng & Lit · B');
    expect(t.columns.slice(0, 4).map((c) => c.key)).toEqual(['sno', 'teacher', 'subject', 'code']);
    expect(t.columns.at(-1)).toMatchObject({ key: 'vsClass', group: 'Against the class' });
  });

  it('one teacher, one subject, girls only', () => {
    const one = teacherAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, of, {
      gender: 'F',
      code: '184',
      teacher: '11',
    });
    // the list of teachers stays whole for the filter; the rows are hers
    expect(one.teachers.map((x) => x.key)).toEqual(['11', 'n:Guest Teacher']);
    expect(one.table.rows.map((x) => [x.section, x.appeared, x.avg])).toEqual([
      ['A', 1, 95],
      ['B', 1, 85],
      ['', 2, 90],
    ]);
  });
});

describe('Subject Summary section wise (docs/design/88)', () => {
  const rows = [
    cand(
      'F',
      [
        ['184', 95],
        ['417', 80],
      ],
      { section: 'A' },
    ),
    cand('M', [['184', 65]], { section: 'A' }),
    cand('F', [['184', 85]], { section: 'B' }),
    cand('M', [['184', 25]], { section: 'B' }),
  ];

  it("each subject's row then a row for each of its sections, and the total's sections", () => {
    const t = subjectPerformance(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      section: 'each',
    });
    expect(t.title).toBe('Subject summary, section wise');
    expect(t.rows.map((x) => [x.sno, x.subject, x.appeared, x.passNo])).toEqual([
      [1, 'English Lng & Lit', 4, 3],
      ['', 'Section A', 2, 2],
      ['', 'Section B', 2, 1],
      [2, 'AI', 1, 1],
      ['', 'Section A', 1, 1],
      ['', 'Total', 5, 4],
      ['', 'Total · Section A', 3, 3],
      ['', 'Total · Section B', 2, 1],
    ]);
    // the subjects' rows and the total in bold
    expect(t.strong).toEqual([0, 3, 5]);
    expect(t.rows[2]).toMatchObject({ avg: 55, boys: 1, girls: 1 });
  });

  it("one section's students only", () => {
    const t = subjectPerformance(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      section: 'B',
    });
    expect(t.title).toBe('Subject summary, section B');
    expect(t.rows.map((x) => [x.subject, x.appeared])).toEqual([
      ['English Lng & Lit', 2],
      ['Total', 2],
    ]);
  });
});

describe('Result Analysis section wise, with the teachers (docs/design/88)', () => {
  const rows = [
    cand(
      'F',
      [
        ['184', 95],
        ['417', 80],
      ],
      { section: 'A' },
    ),
    cand('M', [['184', 65]], { section: 'A' }),
    cand('F', [['184', 85]], { section: 'B' }),
    cand('M', [['184', 25]], { section: 'B' }),
  ];
  const of: TeachersOf = (section, code) =>
    code !== '184'
      ? []
      : section === 'A'
        ? [{ id: '11', name: 'Asha Teacher' }]
        : [
            { id: '11', name: 'Asha Teacher' },
            { id: null, name: 'Guest Teacher' },
          ];

  it("each subject's bold row, its sections with their teachers, the total's sections", () => {
    const t = resultAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      section: 'each',
      teachersOf: of,
    });
    expect(t.title).toBe('Result analysis, section wise');
    expect(t.columns.slice(0, 4).map((c) => c.key)).toEqual(['sno', 'code', 'subject', 'teacher']);
    expect(t.rows.map((x) => [x.sno, x.subject, x.teacher, x.appeared, x.passNo])).toEqual([
      [1, 'English Lng & Lit', '', 4, 3],
      ['', 'Section A', 'Asha Teacher', 2, 2],
      ['', 'Section B', 'Asha Teacher, Guest Teacher', 2, 1],
      [2, 'AI', '', 1, 1],
      ['', 'Section A', 'Not set', 1, 1],
      ['', 'Total', '', 5, 4],
      ['', 'Total · Section A', '', 3, 3],
      ['', 'Total · Section B', '', 2, 1],
    ]);
    expect(t.strong).toEqual([0, 3, 5]);
  });

  it('all sections together name every teacher of the subject; one section; boys and girls rows', () => {
    const together = resultAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      teachersOf: of,
    });
    expect(together.rows[0]).toMatchObject({ teacher: 'Asha Teacher, Guest Teacher', appeared: 4 });
    expect(together.rows[1]).toMatchObject({ subject: 'AI', teacher: 'Not set' });
    const b = resultAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'all',
      section: 'B',
      teachersOf: of,
    });
    expect(b.title).toBe('Result analysis, section B');
    expect(b.rows.map((x) => [x.subject, x.teacher, x.appeared])).toEqual([
      ['English Lng & Lit', 'Asha Teacher, Guest Teacher', 2],
      ['Total', '', 2],
    ]);
    const both = resultAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, {
      gender: 'both',
      section: 'each',
      code: '184',
      teachersOf: of,
    });
    expect(both.rows.slice(0, 6).map((x) => [x.subject, x.teacher, x.appeared])).toEqual([
      ['English Lng & Lit · All', '', 4],
      ['English Lng & Lit · Boys', '', 2],
      ['English Lng & Lit · Girls', '', 2],
      ['Section A · All', 'Asha Teacher', 2],
      ['Section A · Boys', '', 1],
      ['Section A · Girls', '', 1],
    ]);
    // without the teachers, no Teacher column
    expect(
      resultAnalysisTable(rows, SUBJECTS, DEFAULT_BOARD_RULES, { gender: 'all' }).columns.some(
        (c) => c.key === 'teacher',
      ),
    ).toBe(false);
  });
});
