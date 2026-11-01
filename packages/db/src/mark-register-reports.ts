/**
 * The Run reports of a mark register (docs/design/68, phase 2), as the school's Term Mark Register has
 * them: Result summary, Analysis, Entry status, Toppers, Teacher-wise, At-risk, Failing students and
 * Compare sections. Pure functions over the register's worked-out rows (and, for entry status, the
 * loaded marks): each gives titled tables in the register's sheet form, so the screen, the PDF and the
 * Excel lay them out as they do the register. A count carries the students it stands for (shown on a
 * click). Every report reads the same results as the register, so the figures always agree.
 */
import {
  cutFixed,
  properCase,
  type RegisterDef,
  type RegStudent,
  type RegStudentResult,
  type RegSubjectResult,
  type Sheet,
  type SheetCell,
} from './mark-register';

export type ReportKind =
  'summary' | 'analysis' | 'entry' | 'toppers' | 'teacher' | 'risk' | 'failing' | 'compare';

export const REPORTS: Array<{ kind: ReportKind; label: string; merit?: boolean }> = [
  { kind: 'summary', label: 'Result summary' },
  { kind: 'analysis', label: 'Analysis' },
  { kind: 'entry', label: 'Entry status' },
  { kind: 'toppers', label: 'Toppers' },
  { kind: 'teacher', label: 'Teacher-wise' },
  { kind: 'risk', label: 'At-risk' },
  { kind: 'failing', label: 'Failing students' },
  { kind: 'compare', label: 'Compare sections', merit: true },
];

export interface ReportBlock {
  title: string;
  sheet: Sheet;
}
export interface ReportInput {
  def: RegisterDef;
  /** the worked-out students of the place, in the register's order */
  rows: RegStudentResult[];
  /** the loaded marks (entry status) */
  students: RegStudent[];
  place: string;
  /** every section of a class together */
  merit: boolean;
  /** register subject keys in the order printed */
  order: string[];
  titles: Record<string, string>;
  /** a section's subject teacher: `${sectionId}|${subjectId}` → name */
  teachers?: Record<string, string>;
  /** Toppers: the top N */
  top?: number;
  /** At-risk: how far above the pass % is borderline */
  margin?: number;
}

type Col = [label: string, width: number, text?: boolean];
const RESULT: Record<RegStudentResult['result'], string> = {
  pass: 'Pass',
  compartment: 'Compartment',
  fail: 'Fail',
  absent: 'Absent',
  incomplete: 'Incomplete',
};

function block(
  i: ReportInput,
  title: string,
  cols: Col[],
  rows: SheetCell[][],
  group?: Array<{ t: string; span: number }>,
): ReportBlock {
  const head: SheetCell[][] = [];
  group = group?.filter((g) => g.span > 0);
  if (group) {
    const top: SheetCell[] = [];
    let at = 0;
    for (const g of group) {
      if (g.t === '') {
        for (let k = 0; k < g.span; k += 1) {
          const c = cols[at + k]!;
          top.push({ t: c[0], rows: 2, text: c[2] });
        }
      } else top.push({ t: g.t, span: g.span, text: true });
      at += g.span;
    }
    const bottom: SheetCell[] = [];
    at = 0;
    for (const g of group) {
      if (g.t !== '') for (let k = 0; k < g.span; k += 1) bottom.push({ t: cols[at + k]![0] });
      at += g.span;
    }
    head.push(top, bottom);
  } else head.push(cols.map(([t, , text]) => ({ t, text })));
  return {
    title,
    sheet: {
      place: i.place,
      title,
      head,
      body: rows.map((cells, n) => ({ studentId: `${title}-${String(n)}`, cells })),
      foot: null,
      frozen: 1,
      widths: cols.map(([, w]) => w),
    },
  };
}

const nameOf = (i: ReportInput, r: RegStudentResult) =>
  i.def.display.properCase ? properCase(r.name) : r.name;
const who = (i: ReportInput, r: RegStudentResult) =>
  i.merit ? `${nameOf(i, r)} (${r.section})` : nameOf(i, r);
const count = (i: ReportInput, list: RegStudentResult[]): SheetCell => ({
  t: String(list.length),
  ...(list.length ? { names: list.map((r) => who(i, r)) } : {}),
});
const pct = (n: number, of: number) => (of > 0 ? cutFixed((n / of) * 100, 2) : '');
const avg = (vals: number[]) =>
  vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

/** each subject (a slot: each of its members) with the students who take it */
function subjectsOf(i: ReportInput) {
  const out: Array<{
    label: string;
    key: string;
    list: Array<{ r: RegStudentResult; x: RegSubjectResult }>;
  }> = [];
  for (const k of i.order) {
    const s = i.def.subjects.find((x) => x.key === k);
    if (!s) continue;
    const takers = i.rows
      .map((r) => ({ r, x: r.subjects[k] }))
      .filter((y): y is { r: RegStudentResult; x: RegSubjectResult } => !!y.x);
    if (!takers.length) continue;
    if (s.slot) {
      for (const code of [...new Set(takers.map((y) => y.x.code))])
        out.push({
          label: `${i.titles[k] ?? k} · ${code}`,
          key: `${k}|${code}`,
          list: takers.filter((y) => y.x.code === code),
        });
    } else out.push({ label: i.titles[k] ?? k, key: k, list: takers });
  }
  return out;
}

// ---- Result summary --------------------------------------------------------------------------------
function summary(i: ReportInput): ReportBlock[] {
  const rows = i.rows;
  const by = (res: RegStudentResult['result']) => rows.filter((r) => r.result === res);
  const appeared = rows.filter((r) => ['pass', 'compartment', 'fail'].includes(r.result));
  const passed = by('pass');
  const head: SheetCell[][] = [
    [{ t: 'Students', text: true }, count(i, rows)],
    [{ t: 'Appeared (a final)', text: true }, count(i, appeared)],
    [{ t: 'Passed', text: true }, count(i, passed)],
    [
      { t: `Compartment (failed in 1–${String(i.def.final.compartmentUpTo)})`, text: true },
      count(i, by('compartment')),
    ],
    [{ t: 'Failed', text: true }, count(i, by('fail'))],
    [{ t: 'Absent (final withheld)', text: true }, count(i, by('absent'))],
    [{ t: 'Marks not entered yet', text: true }, count(i, by('incomplete'))],
    [
      { t: 'Pass % (passed of appeared)', text: true },
      { t: pct(passed.length, appeared.length), tone: 'final' },
    ],
  ];
  const out = [
    block(
      i,
      'Result summary',
      [
        ['Figure', 6, true],
        ['Students', 1.4],
      ],
      head,
    ),
  ];
  const failedIn = new Map<number, RegStudentResult[]>();
  for (const r of rows)
    if (r.failed.length)
      failedIn.set(r.failed.length, [...(failedIn.get(r.failed.length) ?? []), r]);
  if (failedIn.size)
    out.push(
      block(
        i,
        'Failed in N subjects',
        [
          ['Failed in', 2, true],
          ['Students', 1.2],
          ['Who (subjects)', 8, true],
        ],
        [...failedIn.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([n, list]) => [
            { t: `${String(n)} subject${n === 1 ? '' : 's'}`, text: true },
            count(i, list),
            { t: list.map((r) => `${who(i, r)}: ${r.failed.join(', ')}`).join('; '), text: true },
          ]),
      ),
    );
  const absentIn = new Map<number, RegStudentResult[]>();
  for (const r of rows)
    if (r.withheldBy.length)
      absentIn.set(r.withheldBy.length, [...(absentIn.get(r.withheldBy.length) ?? []), r]);
  if (absentIn.size)
    out.push(
      block(
        i,
        'Absent in N subjects (a code that holds the total)',
        [
          ['Absent in', 2, true],
          ['Students', 1.2],
          ['Who (subjects)', 8, true],
        ],
        [...absentIn.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([n, list]) => [
            { t: `${String(n)} subject${n === 1 ? '' : 's'}`, text: true },
            count(i, list),
            {
              t: list.map((r) => `${who(i, r)}: ${r.withheldBy.join(', ')}`).join('; '),
              text: true,
            },
          ]),
      ),
    );
  // a code that does not hold the total (medical leave, exempted …) in a counted column
  const leave = new Map<number, Array<{ r: RegStudentResult; subjects: string[] }>>();
  for (const r of rows) {
    const subjects = Object.values(r.subjects)
      .filter((x): x is RegSubjectResult => !!x && x.inFinal)
      .filter((x) => x.counted.some((k) => x.values[k]?.code && !x.values[k]?.blocked))
      .map((x) => x.code);
    if (subjects.length)
      leave.set(subjects.length, [...(leave.get(subjects.length) ?? []), { r, subjects }]);
  }
  if (leave.size)
    out.push(
      block(
        i,
        'Medical leave or another code in N subjects',
        [
          ['In', 2, true],
          ['Students', 1.2],
          ['Who (subjects)', 8, true],
        ],
        [...leave.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([n, list]) => [
            { t: `${String(n)} subject${n === 1 ? '' : 's'}`, text: true },
            count(
              i,
              list.map((y) => y.r),
            ),
            {
              t: list.map((y) => `${who(i, y.r)}: ${y.subjects.join(', ')}`).join('; '),
              text: true,
            },
          ]),
      ),
    );
  return out;
}

// ---- Analysis --------------------------------------------------------------------------------------
function analysis(i: ReportInput): ReportBlock[] {
  const bands = [...i.def.analysis.bands].sort((a, b) => b.fromPct - a.fromPct);
  const cuml = i.def.analysis.cumulative;
  const reach = (p: number, op: '>=' | '>', at: number) => (op === '>' ? p > at : p >= at);
  const bandOf = (p: number) => bands.find((b) => reach(p, b.op, b.fromPct))?.label ?? null;
  const ordered = [...bands].reverse();
  const cols: Col[] = [
    ['Subject', 3, true],
    ['Students', 1],
    ['Absent', 1],
    ['Appeared', 1],
    ...ordered.map((b): Col => [b.label, 1]),
    ...cuml.map((c): Col => [`${c.op}${String(c.pct)}%`, 1]),
    ['Highest', 1.1],
    ['Lowest', 1.1],
    ['Average', 1.1],
    ['Passing %', 1.1],
  ];
  const rows = subjectsOf(i).map((s) => {
    const absent = s.list.filter((y) => y.x.withheld);
    const appeared = s.list.filter((y) => !y.x.withheld && y.x.pct !== null && !y.x.missing);
    const totals = appeared.map((y) => y.x.total!);
    const max = Math.max(0, ...appeared.map((y) => y.x.max));
    const passed = appeared.filter((y) => y.x.status === 'pass');
    const names = (l: typeof s.list) =>
      count(
        i,
        l.map((y) => y.r),
      );
    return [
      { t: s.label, text: true },
      names(s.list),
      names(absent),
      names(appeared),
      ...ordered.map((b) => names(appeared.filter((y) => bandOf(y.x.pct!) === b.label))),
      ...cuml.map((c) => names(appeared.filter((y) => reach(y.x.pct!, c.op, c.pct)))),
      {
        t: totals.length
          ? `${cutFixed(Math.max(...totals), 'auto')} / ${cutFixed(max, 'auto')}`
          : '',
      },
      { t: totals.length ? cutFixed(Math.min(...totals), 'auto') : '' },
      { t: totals.length ? cutFixed(avg(totals)!, 2) : '' },
      { t: pct(passed.length, appeared.length), tone: 'final' as const },
    ];
  });
  return [
    block(i, 'Result analysis (by the subject’s %)', cols, rows, [
      { t: '', span: 4 },
      { t: 'Students in each band', span: ordered.length },
      { t: 'Cumulative', span: cuml.length },
      { t: '', span: 4 },
    ]),
  ];
}

// ---- Entry status ----------------------------------------------------------------------------------
function entry(i: ReportInput): ReportBlock[] {
  const sections = [...new Map(i.students.map((s) => [s.sectionId, s.section])).entries()];
  const lines: Array<{
    subject: string;
    subjectId: string;
    exam: string;
    section: string;
    sectionId: string;
    takers: RegStudent[];
    done: RegStudent[];
  }> = [];
  for (const k of i.order) {
    const s = i.def.subjects.find((x) => x.key === k);
    if (!s) continue;
    const members = s.slot ? s.slot.members : [s.subjectId ?? ''];
    for (const m of members)
      for (const e of i.def.exams)
        for (const [sectionId, section] of sections) {
          const takers = i.students.filter(
            (st) =>
              st.sectionId === sectionId &&
              st.subjects.some((x) => x.subjectId === m && x.marks[e.key]),
          );
          if (!takers.length) continue;
          const sub = (st: RegStudent) => st.subjects.find((x) => x.subjectId === m)!;
          const done = takers.filter((st) => {
            const mk = sub(st).marks[e.key]!;
            return mk.entered || (mk.parts.length > 0 && mk.parts.every((p) => p.entered));
          });
          lines.push({
            subject: s.slot ? `${i.titles[k] ?? k} · ${sub(takers[0]!).code}` : (i.titles[k] ?? k),
            subjectId: m,
            exam: e.key,
            section,
            sectionId,
            takers,
            done,
          });
        }
  }
  const status = (l: (typeof lines)[number]) =>
    l.done.length === l.takers.length ? 'Complete' : l.done.length ? 'Partial' : 'Not started';
  if (!i.merit)
    return [
      block(
        i,
        'Marks entry status',
        [
          ['Subject', 3, true],
          ['Exam', 1.2, true],
          ['Entered', 1.2],
          ['Status', 1.4, true],
          ['Teacher', 2.5, true],
          ['Not entered yet', 6, true],
        ],
        lines.map((l) => {
          const pending = l.takers
            .filter((st) => !l.done.includes(st))
            .map((st) => (i.def.display.properCase ? properCase(st.name) : st.name));
          return [
            { t: l.subject, text: true },
            { t: l.exam, text: true },
            { t: `${String(l.done.length)}/${String(l.takers.length)}` },
            {
              t: status(l),
              text: true,
              tone: status(l) === 'Complete' ? 'calc' : status(l) === 'Partial' ? 'warn' : 'code',
            },
            { t: i.teachers?.[`${l.sectionId}|${l.subjectId}`] ?? '', text: true },
            { t: pending.join(', '), text: true, ...(pending.length ? { names: pending } : {}) },
          ];
        }),
      ),
    ];
  // a class: the sections against the subjects, the share entered of every exam
  const subjects = [...new Set(lines.map((l) => l.subject))];
  return [
    block(
      i,
      'Marks entry status (% entered, every exam)',
      [['Section', 1.4, true], ...subjects.map((s): Col => [s, 1.3])],
      sections.map(([sectionId, section]) => [
        { t: section, text: true },
        ...subjects.map((s): SheetCell => {
          const of = lines.filter((l) => l.subject === s && l.sectionId === sectionId);
          const want = of.reduce((a, l) => a + l.takers.length, 0);
          const got = of.reduce((a, l) => a + l.done.length, 0);
          if (!want) return { t: '—', tone: 'none' };
          return { t: `${pct(got, want)}%`, tone: got === want ? 'calc' : got ? 'warn' : 'code' };
        }),
      ]),
    ),
  ];
}

// ---- Toppers ---------------------------------------------------------------------------------------
function toppers(i: ReportInput): ReportBlock[] {
  const n = i.top ?? 3;
  const rankOf = (r: RegStudentResult) => (i.merit ? r.rankInClass : r.rankInSection);
  const passed = i.rows.filter((r) => r.result === 'pass' && rankOf(r) !== null);
  const list = (
    rows: RegStudentResult[],
    rank: (r: RegStudentResult) => number | null,
    top: number,
  ) =>
    rows
      .filter((r) => (rank(r) ?? Infinity) <= top)
      .sort((a, b) => rank(a)! - rank(b)! || a.name.localeCompare(b.name));
  const cols: Col[] = [
    ['Rank', 0.8],
    ['Student', 4, true],
    ...(i.merit ? [['Section', 1.2, true] as Col] : []),
    ['Total', 1.6],
    ['%', 1],
    ['Grade', 0.9],
  ];
  const line = (r: RegStudentResult, rank: number | null): SheetCell[] => [
    { t: String(rank ?? '') },
    { t: nameOf(i, r), text: true },
    ...(i.merit ? [{ t: r.section, text: true } as SheetCell] : []),
    {
      t: r.total === null ? '' : `${cutFixed(r.total, 'auto')} / ${cutFixed(r.max, 'auto')}`,
      tone: 'final',
    },
    { t: r.pct === null ? '' : cutFixed(r.pct, 2) },
    { t: r.grade ?? '' },
  ];
  const out = [
    block(
      i,
      `Top ${String(n)}${i.merit ? ' of the class' : ''} (passed)`,
      cols,
      list(passed, rankOf, n).map((r) => line(r, rankOf(r))),
    ),
  ];
  if (i.merit)
    for (const sec of [...new Set(i.rows.map((r) => r.section))].sort())
      out.push(
        block(
          i,
          `Top 3 of ${sec}`,
          cols,
          list(
            passed.filter((r) => r.section === sec),
            (r) => r.rankInSection,
            3,
          ).map((r) => line(r, r.rankInSection)),
        ),
      );
  // each subject's topper (every one tied at the top)
  const rows: SheetCell[][] = [];
  for (const s of subjectsOf(i)) {
    const ok = s.list.filter((y) => !y.x.withheld && y.x.total !== null && !y.x.missing);
    if (!ok.length) continue;
    const best = Math.max(...ok.map((y) => y.x.total!));
    const top = ok.filter((y) => Math.abs(y.x.total! - best) < 1e-9);
    const max = top[0]!.x.max;
    rows.push([
      { t: s.label, text: true },
      { t: top.map((y) => who(i, y.r)).join(', '), text: true },
      { t: `${cutFixed(best, 'auto')} / ${cutFixed(max, 'auto')}`, tone: 'final' },
      { t: Math.abs(best - max) < 1e-9 ? 'Full marks' : '', text: true },
    ]);
  }
  out.push(
    block(
      i,
      'The topper of every subject',
      [
        ['Subject', 3, true],
        ['Topper', 6, true],
        ['Marks', 1.6],
        ['', 1.4, true],
      ],
      rows,
    ),
  );
  return out;
}

// ---- Teacher-wise ----------------------------------------------------------------------------------
function teacherWise(i: ReportInput): ReportBlock[] {
  const groups = new Map<
    string,
    {
      teacher: string;
      subject: string;
      section: string;
      list: Array<{ r: RegStudentResult; x: RegSubjectResult }>;
    }
  >();
  for (const s of subjectsOf(i))
    for (const y of s.list) {
      const t = i.teachers?.[`${y.r.sectionId}|${y.x.subjectId}`] ?? 'Not assigned';
      const key = `${t}|${s.label}|${y.r.section}`;
      const g = groups.get(key) ?? { teacher: t, subject: s.label, section: y.r.section, list: [] };
      g.list.push(y);
      groups.set(key, g);
    }
  const rows = [...groups.values()]
    .sort(
      (a, b) =>
        a.teacher.localeCompare(b.teacher) ||
        a.subject.localeCompare(b.subject) ||
        a.section.localeCompare(b.section),
    )
    .map((g) => {
      const appeared = g.list.filter((y) => !y.x.withheld && y.x.pct !== null && !y.x.missing);
      const pcts = appeared.map((y) => y.x.pct!);
      const failed = appeared.filter((y) => y.x.status === 'fail');
      return [
        { t: g.teacher, text: true },
        { t: g.subject, text: true },
        { t: g.section, text: true },
        count(
          i,
          g.list.map((y) => y.r),
        ),
        count(
          i,
          appeared.map((y) => y.r),
        ),
        { t: pcts.length ? cutFixed(avg(pcts)!, 2) : '' },
        { t: pct(appeared.length - failed.length, appeared.length), tone: 'final' as const },
        {
          t: appeared.length ? cutFixed(Math.max(...appeared.map((y) => y.x.total!)), 'auto') : '',
        },
        count(
          i,
          failed.map((y) => y.r),
        ),
      ];
    });
  return [
    block(
      i,
      'Teacher-wise result (the subject teacher of each section)',
      [
        ['Teacher', 3, true],
        ['Subject', 3, true],
        ['Section', 1.2, true],
        ['Students', 1],
        ['Appeared', 1],
        ['Average %', 1.2],
        ['Pass %', 1.1],
        ['Highest', 1.1],
        ['Failed', 1],
      ],
      rows,
    ),
  ];
}

// ---- At-risk ---------------------------------------------------------------------------------------
function atRisk(i: ReportInput): ReportBlock[] {
  const margin = i.margin ?? 5;
  const pass = i.def.final.passPct;
  type Risk = { r: RegStudentResult; level: 'High' | 'Medium' | 'Watch'; notes: string[] };
  const risks: Risk[] = [];
  const perSubject = new Map<
    string,
    { fail: RegStudentResult[]; border: RegStudentResult[]; absent: RegStudentResult[] }
  >();
  const bump = (label: string, kind: 'fail' | 'border' | 'absent', r: RegStudentResult) => {
    const g = perSubject.get(label) ?? { fail: [], border: [], absent: [] };
    g[kind].push(r);
    perSubject.set(label, g);
  };
  for (const s of subjectsOf(i))
    for (const y of s.list) {
      if (y.x.withheld) bump(s.label, 'absent', y.r);
      else if (y.x.status === 'fail') bump(s.label, 'fail', y.r);
      else if (y.x.pct !== null && y.x.pct >= pass && y.x.pct < pass + margin)
        bump(s.label, 'border', y.r);
    }
  for (const r of i.rows) {
    const notes: string[] = [];
    for (const x of Object.values(r.subjects)) {
      if (!x || !x.inFinal) continue;
      if (x.withheld) notes.push(`${x.code} absent`);
      else if (x.status === 'fail') notes.push(`${x.code} ${cutFixed(x.pct, 2)}%`);
      else if (x.pct !== null && x.pct >= pass && x.pct < pass + margin)
        notes.push(`${x.code} ${cutFixed(x.pct, 2)}% (borderline)`);
    }
    const level =
      r.result === 'fail'
        ? 'High'
        : r.result === 'compartment'
          ? 'Medium'
          : notes.length
            ? 'Watch'
            : null;
    if (level) risks.push({ r, level, notes });
  }
  const order = { High: 0, Medium: 1, Watch: 2 };
  risks.sort((a, b) => order[a.level] - order[b.level] || a.r.name.localeCompare(b.r.name));
  return [
    block(
      i,
      `At-risk students (borderline: ${String(pass)}% to ${String(pass + margin)}%)`,
      [
        ['Level', 1.2, true],
        ['Student', 4, true],
        ...(i.merit ? [['Section', 1.2, true] as Col] : []),
        ['Subjects', 7, true],
        ['%', 1],
        ['Result', 1.4, true],
      ],
      risks.map((x) => [
        {
          t: x.level,
          text: true,
          tone: x.level === 'High' ? 'code' : x.level === 'Medium' ? 'warn' : undefined,
        },
        { t: nameOf(i, x.r), text: true },
        ...(i.merit ? [{ t: x.r.section, text: true } as SheetCell] : []),
        { t: x.notes.join(', '), text: true },
        { t: x.r.pct === null ? '' : cutFixed(x.r.pct, 2) },
        { t: RESULT[x.r.result], text: true },
      ]),
    ),
    block(
      i,
      'By subject',
      [
        ['Subject', 3, true],
        ['Failing', 1.2],
        ['Borderline', 1.2],
        ['Absent', 1.2],
      ],
      [...perSubject.entries()].map(([label, g]) => [
        { t: label, text: true },
        count(i, g.fail),
        count(i, g.border),
        count(i, g.absent),
      ]),
    ),
  ];
}

// ---- Failing students ------------------------------------------------------------------------------
function failing(i: ReportInput): ReportBlock[] {
  const rows: SheetCell[][] = [];
  for (const sec of [...new Set(i.rows.map((r) => r.section))].sort()) {
    const of = i.rows.filter((r) => r.section === sec && r.failed.length);
    if (!of.length) {
      rows.push([
        { t: sec, text: true },
        { t: 'NIL', text: true, tone: 'calc' },
        { t: '' },
        { t: '' },
        { t: '' },
        { t: '' },
      ]);
      continue;
    }
    for (const r of of)
      for (const [n, code] of r.failed.entries()) {
        const x = Object.values(r.subjects).find((y) => y?.code === code);
        rows.push([
          { t: n === 0 ? sec : '', text: true },
          { t: n === 0 ? nameOf(i, r) : '', text: true },
          { t: x ? `${x.name} (${x.code})` : code, text: true },
          { t: x?.pct === null || x?.pct === undefined ? '' : cutFixed(x.pct, 2), tone: 'code' },
          {
            t:
              n === 0 && r.total !== null
                ? `${cutFixed(r.total, 'auto')} / ${cutFixed(r.max, 'auto')}`
                : '',
          },
          { t: n === 0 && r.pct !== null ? cutFixed(r.pct, 2) : '' },
        ]);
      }
  }
  return [
    block(
      i,
      'Students failing in one or more subjects',
      [
        ['Section', 1.2, true],
        ['Student', 4, true],
        ['Failing subject', 4, true],
        ['Its %', 1.1],
        ['Total', 1.6],
        ['%', 1],
      ],
      rows,
    ),
  ];
}

// ---- Compare sections ------------------------------------------------------------------------------
function compare(i: ReportInput): ReportBlock[] {
  const sections = [...new Set(i.rows.map((r) => r.section))].sort();
  const places = [...sections, 'Class'];
  const stats = (list: Array<{ r: RegStudentResult; x: RegSubjectResult }>) => {
    const ok = list.filter((y) => !y.x.withheld && y.x.pct !== null && !y.x.missing);
    return {
      avg: avg(ok.map((y) => y.x.pct!)),
      pass: ok.length ? (ok.filter((y) => y.x.status === 'pass').length / ok.length) * 100 : null,
      high: ok.length ? Math.max(...ok.map((y) => y.x.total!)) : null,
    };
  };
  const cols: Col[] = [['Subject', 3, true]];
  for (let n = 0; n < places.length; n += 1) cols.push(['Avg %', 1], ['Pass %', 1], ['Highest', 1]);
  const rows = subjectsOf(i).map((s) => {
    const per = places.map((p) =>
      stats(p === 'Class' ? s.list : s.list.filter((y) => y.r.section === p)),
    );
    const bestAvg = Math.max(...per.slice(0, sections.length).map((x) => x.avg ?? -1));
    return [
      { t: s.label, text: true },
      ...per.flatMap((x, n): SheetCell[] => [
        {
          t:
            x.avg === null
              ? ''
              : `${n < sections.length && x.avg === bestAvg && sections.length > 1 ? '▲ ' : ''}${cutFixed(x.avg, 2)}`,
          tone: n === places.length - 1 ? 'final' : undefined,
        },
        {
          t: x.pass === null ? '' : cutFixed(x.pass, 2),
          tone: n === places.length - 1 ? 'final' : undefined,
        },
        {
          t: x.high === null ? '' : cutFixed(x.high, 'auto'),
          tone: n === places.length - 1 ? 'final' : undefined,
        },
      ]),
    ];
  });
  const overall = places.map((p) => {
    const list = p === 'Class' ? i.rows : i.rows.filter((r) => r.section === p);
    const appeared = list.filter((r) => ['pass', 'compartment', 'fail'].includes(r.result));
    return {
      list,
      appeared,
      passed: appeared.filter((r) => r.result === 'pass'),
      pcts: appeared.map((r) => r.pct ?? 0),
    };
  });
  const overallRows: SheetCell[][] = [
    [{ t: 'Students', text: true }, ...overall.map((o) => count(i, o.list))],
    [{ t: 'Appeared', text: true }, ...overall.map((o) => count(i, o.appeared))],
    [{ t: 'Passed', text: true }, ...overall.map((o) => count(i, o.passed))],
    [
      { t: 'Pass %', text: true },
      ...overall.map((o): SheetCell => ({
        t: pct(o.passed.length, o.appeared.length),
        tone: 'final',
      })),
    ],
    [
      { t: 'Average %', text: true },
      ...overall.map((o): SheetCell => ({ t: o.pcts.length ? cutFixed(avg(o.pcts)!, 2) : '' })),
    ],
  ];
  return [
    block(i, 'Section comparison by subject (▲ the best section)', cols, rows, [
      { t: '', span: 1 },
      ...places.map((p) => ({ t: p, span: 3 })),
    ]),
    block(i, 'Overall', [['Figure', 3, true], ...places.map((p): Col => [p, 1.2])], overallRows),
  ];
}

/** a report of a register for one place */
export function buildReport(kind: ReportKind, i: ReportInput): ReportBlock[] {
  switch (kind) {
    case 'summary':
      return summary(i);
    case 'analysis':
      return analysis(i);
    case 'entry':
      return entry(i);
    case 'toppers':
      return toppers(i);
    case 'teacher':
      return teacherWise(i);
    case 'risk':
      return atRisk(i);
    case 'failing':
      return failing(i);
    default:
      return i.merit
        ? compare(i)
        : [
            block(
              i,
              'Compare sections',
              [['', 8, true]],
              [[{ t: 'Pick a class’s “all sections” to compare its sections.', text: true }]],
            ),
          ];
  }
}
