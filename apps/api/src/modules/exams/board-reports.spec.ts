import { DEFAULT_BOARD_RULES, type AnCandidate, type AnSubject } from './board-analysis';
import { rangeOverall, rangeSubjectSummary, subjectPerformance } from './board-reports';

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
    expect(v('gE').count).toBe(1);
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
    expect(printed.blocks[1]!.rows.find((x) => x.key === 'gE')!.label).toBe(
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
});
