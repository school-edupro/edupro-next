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
  /** a section's subject teachers (`${sectionId}|${subjectId}`) and class teacher (`${sectionId}|class`) */
  teachers?: Record<string, string[]>;
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
type Who = { r: RegStudentResult; x?: RegSubjectResult };
/**
 * A count that opens its students: name, admission no (and section in a class), and the marks — the
 * subject's when the count is about one subject, else the final — with the %.
 */
function count(i: ReportInput, title: string, list: Who[]): SheetCell {
  if (!list.length) return { t: '0' };
  const marks = (y: Who): [string, string] => {
    const total = y.x ? y.x.total : y.r.total;
    const max = y.x ? y.x.max : y.r.max;
    const pc = y.x ? y.x.pct : y.r.pct;
    const held = y.x ? y.x.withheld : y.r.withheldBy.length > 0;
    if (held) return ['–', ''];
    if (total === null) return ['', ''];
    return [
      `${cutFixed(total, 'auto')} / ${cutFixed(max, 'auto')}`,
      pc === null ? '' : `${cutFixed(pc, 'auto')}%`,
    ];
  };
  return {
    t: String(list.length),
    drill: {
      title,
      cols: ['#', 'Name', 'Adm No', ...(i.merit ? ['Section'] : []), 'Marks', '%'],
      rows: list.map((y, n) => [
        String(n + 1),
        nameOf(i, y.r),
        y.r.admissionNo,
        ...(i.merit ? [y.r.section] : []),
        ...marks(y),
      ]),
    },
  };
}
const whom = (list: RegStudentResult[]): Who[] => list.map((r) => ({ r }));
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
      // each language of a slot as its own subject (HINDI, SANSKRIT …), as the legacy lists them
      for (const code of [...new Set(takers.map((y) => y.x.code))]) {
        const list = takers.filter((y) => y.x.code === code);
        out.push({ label: list[0]!.x.name, key: `${k}|${code}`, list });
      }
    } else out.push({ label: i.titles[k] ?? k, key: k, list: takers });
  }
  return out;
}

// ---- Result summary --------------------------------------------------------------------------------
/** the rules the summary follows, in words, from the register's own settings */
function rules(def: RegisterDef): string {
  const f = def.final;
  const codes = Object.values(def.codes).flat();
  const holds = [...new Set(codes.filter((c) => c.blocks).map((c) => c.code))];
  const others = [...new Set(codes.filter((c) => !c.blocks).map((c) => c.code))];
  return [
    `Fail = subject % below ${String(f.passPct)}%`,
    f.compartmentUpTo > 0
      ? `${f.compartmentUpTo === 1 ? '1' : `1–${String(f.compartmentUpTo)}`} failed = Compartment, more = Fail`
      : 'any failed = Fail',
    ...(holds.length ? [`${holds.join(', ')} = absent (not counted as fail)`] : []),
    ...(others.length ? [`${others.slice(0, 3).join(', ')} shown separately`] : []),
    ...(f.optionalMode === 'choices' && !f.optionalInFinal ? ['optional subjects left out'] : []),
  ].join(' · ');
}

/**
 * The legacy's Result Summary: the counts (passed; failed in 1, 2 … subjects as compartment or fail;
 * absent in N; medical leave or another code in N; marks not entered) with each one's % of those who
 * appeared and the pass %, then a table per group: the student, the subjects with their %, the final.
 */
function summary(i: ReportInput): ReportBlock[] {
  const rows = i.rows;
  const f = i.def.final;
  const appeared = rows.filter((r) => ['pass', 'compartment', 'fail'].includes(r.result));
  const passed = rows.filter((r) => r.result === 'pass');
  const of = appeared.length;
  const share = (n: number) => (of > 0 ? `${cutFixed((n / of) * 100, 2)}%` : '');
  const plural = (n: number) => `${String(n)} subject${n === 1 ? '' : 's'}`;
  const upper = (x: RegSubjectResult) => x.name.toUpperCase();
  const final = (r: RegStudentResult): SheetCell => ({
    t: r.withheldBy.length
      ? '–'
      : r.total === null
        ? ''
        : `${cutFixed(r.total, 'auto')} / ${cutFixed(r.max, 'auto')}`,
    tone: 'final',
  });
  type Group = { label: string; list: Array<{ r: RegStudentResult; subjects: string }> };
  const groups: Group[] = [];
  const add = (label: string, r: RegStudentResult, subjects: string) => {
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, list: [] }));
    g.list.push({ r, subjects });
  };
  const taken = (r: RegStudentResult) =>
    Object.values(r.subjects).filter((x): x is RegSubjectResult => !!x && x.inFinal);
  // failed in N subjects: a compartment up to the register's number, a fail above it
  for (const r of [...rows].sort((a, b) => a.failed.length - b.failed.length))
    if (r.failed.length && (r.result === 'compartment' || r.result === 'fail'))
      add(
        `Failed in ${plural(r.failed.length)} — ${r.failed.length <= f.compartmentUpTo ? 'Compartment' : 'Fail'}`,
        r,
        taken(r)
          .filter((x) => x.status === 'fail')
          .map((x) => `${upper(x)} (${String(Math.round(x.pct ?? 0))}%)`)
          .join(', '),
      );
  for (const r of [...rows].sort((a, b) => a.withheldBy.length - b.withheldBy.length))
    if (r.withheldBy.length)
      add(
        `Absent in ${plural(r.withheldBy.length)}`,
        r,
        taken(r)
          .filter((x) => x.withheld)
          .map((x) => {
            const code = x.counted.map((k) => x.values[k]?.code).find((c) => c);
            return `${upper(x)} (${code ?? 'AB'})`;
          })
          .join(', '),
      );
  // a code that does not hold the total (medical leave, exempted …): shown apart
  const leave = rows
    .map((r) => ({
      r,
      list: taken(r).flatMap((x) => {
        const code = x.counted.map((k) => x.values[k]).find((c) => c?.code && !c.blocked)?.code;
        return code ? [`${upper(x)} (${code})`] : [];
      }),
    }))
    .filter((y) => y.list.length)
    .sort((a, b) => a.list.length - b.list.length);
  for (const y of leave)
    add(`Medical leave / code in ${plural(y.list.length)}`, y.r, y.list.join(', '));
  for (const r of rows)
    if (r.result === 'incomplete')
      add(
        'Marks not entered yet',
        r,
        taken(r)
          .filter((x) => x.missing)
          .map(upper)
          .join(', '),
      );

  const main: SheetCell[][] = [
    [
      { t: 'Total students', text: true, strong: true },
      { t: String(rows.length), center: true, strong: true },
      { t: '' },
    ],
    [
      { t: 'Passed (no failure, no absence)', text: true, strong: true },
      { t: String(passed.length), center: true, strong: true },
      { t: share(passed.length), center: true },
    ],
    ...groups.map((g): SheetCell[] => [
      { t: g.label, text: true, strong: true },
      { t: String(g.list.length), center: true, strong: true },
      { t: share(g.list.length), center: true },
    ]),
    [
      { t: 'Pass % (passed ÷ appeared)', text: true, tone: 'final' },
      { t: share(passed.length), tone: 'final', span: 2, center: true },
    ],
  ];
  const head = block(
    i,
    `Result Summary — ${String(rows.length)} student(s), ${String(of)} appeared`,
    [
      ['Result', 6, true],
      ['Students', 1.5],
      [`% of ${String(of)} appeared`, 2],
    ],
    main,
  );
  head.sheet.note = rules(i.def);
  const out = [head];
  for (const g of groups)
    out.push(
      block(
        i,
        `${g.label} — ${String(g.list.length)}`,
        [
          ['#', 0.6],
          ['Student Name', 4, true],
          ...(i.merit ? [['Section', 1.2, true] as Col] : []),
          ['Adm No', 1.8],
          ['Subjects', 8, true],
          ['Final', 2],
        ],
        g.list.map(({ r, subjects }, n): SheetCell[] => [
          { t: String(n + 1), center: true },
          { t: nameOf(i, r), text: true, strong: true },
          ...(i.merit ? [{ t: r.section, text: true } as SheetCell] : []),
          { t: r.admissionNo, center: true },
          { t: subjects, text: true },
          { ...final(r), center: true },
        ]),
      ),
    );
  for (const b of out.slice(1)) {
    const last = b.sheet.head[0]![b.sheet.head[0]!.length - 1]!;
    last.tone = 'final';
  }
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
    const at = (label: string, l: typeof s.list) => count(i, `${s.label} · ${label}`, l);
    return [
      { t: s.label, text: true },
      at('Students', s.list),
      at('Absent', absent),
      at('Appeared', appeared),
      ...ordered.map((b) =>
        at(
          b.label,
          appeared.filter((y) => bandOf(y.x.pct!) === b.label),
        ),
      ),
      ...cuml.map((c) =>
        at(
          `${c.op}${String(c.pct)}%`,
          appeared.filter((y) => reach(y.x.pct!, c.op, c.pct)),
        ),
      ),
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
/**
 * The legacy's Marks Entry Status. A section: a row per subject (each member of a slot apart) with its
 * teachers and students, a column per exam — entered of how many with Complete / Partial / Not
 * started, the pending students on a click, "–" where the subject has no such exam — and the share of
 * every subject at the foot. A class: its sections against the subjects, the % entered of every exam.
 */
function entry(i: ReportInput): ReportBlock[] {
  const sections = [...new Map(i.students.map((s) => [s.sectionId, s.section])).entries()];
  const name = (st: RegStudent) => (i.def.display.properCase ? properCase(st.name) : st.name);
  type Line = {
    subject: string;
    subjectId: string;
    sectionId: string;
    takers: RegStudent[];
    /** by exam key: who takes it in that exam, and who is done */
    exams: Record<string, { takers: RegStudent[]; done: RegStudent[] } | undefined>;
  };
  const lines: Line[] = [];
  for (const k of i.order) {
    const s = i.def.subjects.find((x) => x.key === k);
    if (!s) continue;
    const members = s.slot ? s.slot.members : [s.subjectId ?? ''];
    for (const m of members)
      for (const [sectionId] of sections) {
        const mine = i.students.filter(
          (st) => st.sectionId === sectionId && st.subjects.some((x) => x.subjectId === m),
        );
        const sub = (st: RegStudent) => st.subjects.find((x) => x.subjectId === m)!;
        const exams: Line['exams'] = {};
        for (const e of i.def.exams) {
          const takers = mine.filter((st) => sub(st).marks[e.key]);
          if (!takers.length) continue;
          exams[e.key] = {
            takers,
            // done: a mark or a code; a subject in parts when every part is entered
            done: takers.filter((st) => {
              const mk = sub(st).marks[e.key]!;
              return mk.entered || (mk.parts.length > 0 && mk.parts.every((p) => p.entered));
            }),
          };
        }
        const takers = mine.filter((st) => Object.keys(exams).some((key) => sub(st).marks[key]));
        if (!takers.length) continue;
        lines.push({
          subject: (s.slot ? sub(takers[0]!).name : (i.titles[k] ?? k)).toUpperCase(),
          subjectId: m,
          sectionId,
          takers,
          exams,
        });
      }
  }
  const pctText = (got: number, of: number) => {
    const v = of > 0 ? Math.round((got / of) * 1000) / 10 : 0;
    return `${Number.isInteger(v) ? String(v) : v.toFixed(1)}%`;
  };
  if (!i.merit) {
    const exams = i.def.exams.filter((e) => lines.some((l) => l.exams[e.key]));
    const sectionId = sections[0]?.[0] ?? '';
    const classTeacher = i.teachers?.[`${sectionId}|class`]?.join(', ');
    const rows = lines.map((l, n): SheetCell[] => [
      { t: String(n + 1), center: true },
      { t: l.subject, text: true, strong: true },
      { t: (i.teachers?.[`${l.sectionId}|${l.subjectId}`] ?? []).join(', '), text: true },
      { t: String(l.takers.length), center: true },
      ...exams.map((e): SheetCell => {
        const x = l.exams[e.key];
        if (!x) return { t: '–', center: true, tone: 'none' };
        const pending = x.takers.filter((st) => !x.done.includes(st));
        const state = !pending.length ? 'Complete' : x.done.length ? 'Partial' : 'Not started';
        return {
          t: `${String(x.done.length)} / ${String(x.takers.length)}`,
          center: true,
          strong: true,
          badge: {
            label: state,
            tone: state === 'Complete' ? 'success' : state === 'Partial' ? 'warning' : 'danger',
          },
          ...(pending.length
            ? {
                drillLabel: `${String(pending.length)} pending`,
                drill: {
                  title: `${l.subject} · ${e.key} · pending`,
                  cols: ['#', 'Name', 'Adm No', 'Roll'],
                  rows: pending.map((st, k) => [
                    String(k + 1),
                    name(st),
                    st.admissionNo,
                    st.rollNo === null ? '' : String(st.rollNo),
                  ]),
                },
              }
            : {}),
        };
      }),
    ]);
    const out = block(
      i,
      `Marks Entry Status — ${i.place}`,
      [
        ['#', 0.5],
        ['Subject', 2.6, true],
        ['Teacher', 4, true],
        ['Students', 1],
        ...exams.map((e): Col => [e.key, 1.9]),
      ],
      rows,
    );
    // all subjects of each exam: the share entered
    out.sheet.foot = [
      { t: 'All subjects', span: 4, center: true, strong: true, tone: 'final' },
      ...exams.map((e): SheetCell => {
        const of = lines.reduce((a, l) => a + (l.exams[e.key]?.takers.length ?? 0), 0);
        const got = lines.reduce((a, l) => a + (l.exams[e.key]?.done.length ?? 0), 0);
        return {
          t: `${pctText(got, of)} (${String(got)} / ${String(of)})`,
          center: true,
          tone: 'final',
        };
      }),
    ];
    out.sheet.note = [
      'Entered = any mark (0 included) or code (AB, ML …)',
      'blank = pending',
      'only students who take the subject (subject choices)',
      'a student is done for an exam when every part of it is entered',
      'click “pending” for the names',
      ...(classTeacher ? [`Class teacher: ${classTeacher}`] : []),
    ].join(' · ');
    return [out];
  }
  // a class: the sections against the subjects, the share entered of every exam
  const subjects = [...new Set(lines.map((l) => l.subject))];
  return [
    block(
      i,
      `Marks Entry Status — ${i.place} (% entered, every exam)`,
      [['Section', 1.4, true], ...subjects.map((x): Col => [x, 1.6])],
      sections.map(([sectionId, section]) => [
        { t: section, text: true, strong: true },
        ...subjects.map((x): SheetCell => {
          const of = lines.filter((l) => l.subject === x && l.sectionId === sectionId);
          const want = of.reduce(
            (a, l) => a + Object.values(l.exams).reduce((b, e) => b + (e?.takers.length ?? 0), 0),
            0,
          );
          const got = of.reduce(
            (a, l) => a + Object.values(l.exams).reduce((b, e) => b + (e?.done.length ?? 0), 0),
            0,
          );
          if (!want) return { t: '–', tone: 'none', center: true };
          return {
            t: pctText(got, want),
            center: true,
            badge:
              got === want
                ? { label: 'Complete', tone: 'success' }
                : got
                  ? { label: 'Partial', tone: 'warning' }
                  : { label: 'Not started', tone: 'danger' },
          };
        }),
      ]),
    ),
  ];
}

// ---- Toppers ---------------------------------------------------------------------------------------
/** a % as the legacy prints it: up to two decimals, trailing zeros dropped (100%, 97.44%, 81.9%) */
const pctOf = (v: number | null) => {
  if (v === null) return '';
  return `${String(Math.round(v * 100) / 100)}%`;
};

/**
 * The legacy's Toppers: "Overall Toppers — Top N · by Final Total" (position, student, admission no,
 * final total, %, grade; every tie at a position shown; each section's top 3 in a class), then
 * "Subject Toppers": every subject's highest marks with all ties, "Full marks" marked.
 */
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
  const by = i.def.final.rankBy === 'pct' ? 'Final %' : 'Final Total';
  const cols: Col[] = [
    ['Position', 1, true],
    ['Student Name', 4, true],
    ...(i.merit ? [['Section', 1.2, true] as Col] : []),
    ['Adm No', 1.8],
    ['Final Total', 2],
    ['%', 1.4],
    ['Grade', 1.1],
  ];
  const line = (r: RegStudentResult, rank: number | null): SheetCell[] => [
    { t: '', center: true, badge: { label: String(rank ?? ''), tone: 'info' } },
    { t: nameOf(i, r), text: true, strong: true },
    ...(i.merit ? [{ t: r.section, text: true } as SheetCell] : []),
    { t: r.admissionNo, center: true },
    {
      t: r.total === null ? '' : `${cutFixed(r.total, 'auto')} / ${cutFixed(r.max, 'auto')}`,
      tone: 'final',
      center: true,
      ratio: true,
    },
    { t: r.pct === null ? '' : pctOf(r.pct), tone: 'final', center: true, strong: true },
    { t: r.grade ?? '', tone: 'final', center: true, strong: true },
  ];
  const amber = (b: ReportBlock) => {
    for (const h of b.sheet.head[0]!.slice(-3)) h.tone = 'final';
    for (const h of b.sheet.head[0]!)
      if (h.t !== 'Student Name' && h.t !== 'Section') h.center = true;
    return b;
  };
  const out = [
    amber(
      block(
        i,
        `Overall Toppers — Top ${String(n)}${i.merit ? ' of the class' : ''} · by ${by}`,
        cols,
        list(passed, rankOf, n).map((r) => line(r, rankOf(r))),
      ),
    ),
  ];
  if (i.merit)
    for (const sec of [...new Set(i.rows.map((r) => r.section))].sort())
      out.push(
        amber(
          block(
            i,
            `Top 3 of ${sec} · by ${by}`,
            cols,
            list(
              passed.filter((r) => r.section === sec),
              (r) => r.rankInSection,
              3,
            ).map((r) => line(r, r.rankInSection)),
          ),
        ),
      );
  // every subject's topper, every one tied at the top
  const rows: SheetCell[][] = [];
  for (const s of subjectsOf(i)) {
    const ok = s.list.filter(
      (y) => !y.x.withheld && y.x.total !== null && !y.x.missing && y.x.max > 0,
    );
    if (!ok.length) continue;
    const best = Math.max(...ok.map((y) => y.x.total!));
    const top = ok
      .filter((y) => Math.abs(y.x.total! - best) < 1e-9)
      .sort((a, b) => a.r.name.localeCompare(b.r.name));
    for (const [k, y] of top.entries()) {
      const full = Math.abs(y.x.total! - y.x.max) < 1e-9;
      rows.push([
        { t: k === 0 ? s.label.toUpperCase() : '', text: true, strong: true },
        {
          t: nameOf(i, y.r),
          text: true,
          ...(full ? { badge: { label: 'Full marks', tone: 'success' as const } } : {}),
        },
        ...(i.merit ? [{ t: y.r.section, text: true } as SheetCell] : []),
        { t: y.r.admissionNo, center: true },
        {
          t: `${cutFixed(y.x.total!, 'auto')} / ${cutFixed(y.x.max, 'auto')}`,
          tone: 'calc',
          center: true,
          ratio: true,
        },
        { t: pctOf(y.x.pct), tone: 'calc', center: true },
      ]);
    }
  }
  const subjects = block(
    i,
    'Subject Toppers — highest in each subject (all ties shown)',
    [
      ['Subject', 3, true],
      ['Topper', 5, true],
      ...(i.merit ? [['Section', 1.2, true] as Col] : []),
      ['Adm No', 1.8],
      ['Marks', 1.8],
      ['%', 1.4],
    ],
    rows,
  );
  for (const h of subjects.sheet.head[0]!.slice(-2)) h.tone = 'calc';
  for (const h of subjects.sheet.head[0]!.slice(-3)) h.center = true;
  out.push(subjects);
  return out;
}

// ---- Teacher-wise ----------------------------------------------------------------------------------
/**
 * The legacy's Teacher-wise result: a block per subject teacher (from the teacher assignments) with
 * their sections and subjects — students, appeared, average %, pass %, highest, failed; a subject two
 * teachers share is marked — and their total; the lines with no teacher last, to fix the mapping.
 */
function teacherWise(i: ReportInput): ReportBlock[] {
  const NONE = 'No teacher mapped';
  type Line = {
    subject: string;
    section: string;
    shared: boolean;
    list: Array<{ r: RegStudentResult; x: RegSubjectResult }>;
  };
  const byTeacher = new Map<string, Map<string, Line>>();
  for (const s of subjectsOf(i))
    for (const y of s.list) {
      const ts = i.teachers?.[`${y.r.sectionId}|${y.x.subjectId}`] ?? [];
      const names = ts.length ? ts : [NONE];
      for (const t of names) {
        const lines = byTeacher.get(t) ?? new Map<string, Line>();
        const key = `${y.r.section}|${s.label}`;
        const line = lines.get(key) ?? {
          subject: s.label.toUpperCase(),
          section: y.r.section,
          shared: ts.length > 1,
          list: [],
        };
        line.list.push(y);
        lines.set(key, line);
        byTeacher.set(t, lines);
      }
    }
  const stats = (list: Line['list']) => {
    const appeared = list.filter((y) => !y.x.withheld && y.x.pct !== null && !y.x.missing);
    const failed = appeared.filter((y) => y.x.status === 'fail');
    return { appeared, failed, pcts: appeared.map((y) => y.x.pct!) };
  };
  const teachers = [...byTeacher.keys()].sort((a, b) =>
    a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b),
  );
  const out: ReportBlock[] = [];
  for (const t of teachers) {
    const lines = [...byTeacher.get(t)!.values()].sort(
      (a, b) => a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject),
    );
    const rows = lines.map((l): SheetCell[] => {
      const st = stats(l.list);
      const title = `${l.subject} · ${l.section}`;
      return [
        { t: l.section, text: true, strong: true },
        {
          t: l.subject,
          text: true,
          strong: true,
          ...(l.shared ? { badge: { label: 'shared', tone: 'neutral' as const } } : {}),
        },
        { ...count(i, `${title} · Students`, l.list), center: true },
        { ...count(i, `${title} · Appeared`, st.appeared), center: true },
        { t: st.pcts.length ? pctOf(avg(st.pcts)) : '', tone: 'calc', center: true },
        {
          t: st.appeared.length
            ? pctOf(((st.appeared.length - st.failed.length) / st.appeared.length) * 100)
            : '',
          center: true,
          strong: true,
        },
        {
          t: st.appeared.length
            ? cutFixed(Math.max(...st.appeared.map((y) => y.x.total!)), 'auto')
            : '',
          center: true,
        },
        { ...count(i, `${title} · Failed`, st.failed), center: true },
      ];
    });
    const all = lines.flatMap((l) => l.list);
    const st = stats(all);
    const b = block(
      i,
      t.toUpperCase(),
      [
        ['Section', 1.4, true],
        ['Subject', 3.2, true],
        ['Students', 1.2],
        ['Appeared', 1.2],
        ['Avg %', 1.2],
        ['Pass %', 1.2],
        ['Highest', 1.1],
        ['Failed', 1],
      ],
      rows,
    );
    for (const h of b.sheet.head[0]!.slice(2)) h.center = true;
    b.sheet.head[0]![4]!.tone = 'calc';
    b.sheet.foot = [
      {
        t: `Total — ${String(lines.length)} class${lines.length === 1 ? '' : 'es'}`,
        span: 2,
        text: true,
        strong: true,
        tone: 'final',
      },
      { t: String(all.length), center: true, strong: true, tone: 'final' },
      { t: String(st.appeared.length), center: true, strong: true, tone: 'final' },
      // the average over every student who appeared (each class weighted by its size)
      {
        t: st.pcts.length ? pctOf(Math.round(avg(st.pcts)! * 10) / 10) : '',
        center: true,
        strong: true,
        tone: 'final',
      },
      {
        t: st.appeared.length
          ? pctOf(((st.appeared.length - st.failed.length) / st.appeared.length) * 100)
          : '',
        center: true,
        strong: true,
        tone: 'final',
      },
      { t: '', tone: 'final' },
      { t: String(st.failed.length), center: true, strong: true, tone: 'final' },
    ];
    out.push(b);
  }
  if (out[0])
    out[0].sheet.note = [
      'Teacher = the teacher assignments (Academics → Teacher assignments: the section’s subject teacher)',
      'figures = each line’s own subject summary (AB and withheld left out, Pass % = passed ÷ appeared)',
      `“${NONE}” = assign the teacher to credit them`,
    ].join(' · ');
  return out;
}

// ---- At-risk ---------------------------------------------------------------------------------------
function atRisk(i: ReportInput): ReportBlock[] {
  const margin = i.margin ?? 5;
  const pass = i.def.final.passPct;
  type Risk = { r: RegStudentResult; level: 'High' | 'Medium' | 'Watch'; notes: string[] };
  const risks: Risk[] = [];
  const perSubject = new Map<string, { fail: Who[]; border: Who[]; absent: Who[] }>();
  const bump = (label: string, kind: 'fail' | 'border' | 'absent', y: Who) => {
    const g = perSubject.get(label) ?? { fail: [], border: [], absent: [] };
    g[kind].push(y);
    perSubject.set(label, g);
  };
  for (const s of subjectsOf(i))
    for (const y of s.list) {
      if (y.x.withheld) bump(s.label, 'absent', y);
      else if (y.x.status === 'fail') bump(s.label, 'fail', y);
      else if (y.x.pct !== null && y.x.pct >= pass && y.x.pct < pass + margin)
        bump(s.label, 'border', y);
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
        count(i, `${label} · Failing`, g.fail),
        count(i, `${label} · Borderline`, g.border),
        count(i, `${label} · Absent`, g.absent),
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
    [
      { t: 'Students', text: true },
      ...overall.map((o, n) => count(i, `${places[n]!} · Students`, whom(o.list))),
    ],
    [
      { t: 'Appeared', text: true },
      ...overall.map((o, n) => count(i, `${places[n]!} · Appeared`, whom(o.appeared))),
    ],
    [
      { t: 'Passed', text: true },
      ...overall.map((o, n) => count(i, `${places[n]!} · Passed`, whom(o.passed))),
    ],
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
