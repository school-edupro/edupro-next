/**
 * The Run reports of a mark register (docs/design/68, phase 2), as the school's Term Mark Register has
 * them: Result summary, Analysis, Entry status, Missing marks, Absent students (docs/design/78), Attendance (79), Toppers,
 * Teacher-wise, At-risk, Failing students and Compare sections. Pure functions over the register's worked-out rows (and, for entry status, the
 * loaded marks): each gives titled tables in the register's sheet form, so the screen, the PDF and the
 * Excel lay them out as they do the register. A count carries the students it stands for (shown on a
 * click). Every report reads the same results as the register, so the figures always agree.
 */
import {
  cutFixed,
  properCase,
  type RegisterDef,
  type RegMark,
  type RegStudent,
  type RegStudentResult,
  type RegSubjectResult,
  type Sheet,
  type SheetCell,
} from './mark-register';

export type ReportKind =
  | 'summary'
  | 'analysis'
  | 'entry'
  | 'missing'
  | 'absent'
  | 'attendance'
  | 'toppers'
  | 'teacher'
  | 'risk'
  | 'failing'
  | 'compare';

export const REPORTS: Array<{ kind: ReportKind; label: string; merit?: boolean }> = [
  { kind: 'summary', label: 'Result summary' },
  { kind: 'analysis', label: 'Analysis' },
  { kind: 'entry', label: 'Entry status' },
  // docs/design/78
  { kind: 'missing', label: 'Missing marks' },
  { kind: 'absent', label: 'Absent students' },
  // docs/design/79
  { kind: 'attendance', label: 'Attendance' },
  { kind: 'toppers', label: 'Toppers' },
  { kind: 'teacher', label: 'Teacher-wise' },
  { kind: 'risk', label: 'At-risk' },
  { kind: 'failing', label: 'Failing students' },
  { kind: 'compare', label: 'Compare sections', merit: true },
];

export interface ReportBlock {
  title: string;
  sheet: Sheet;
  /** false: the table names itself in its first heading (no band over it) */
  band?: boolean;
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
  /** one subject picked at Run (its register key): Analysis of a class then goes section by section */
  subject?: string;
  /** Toppers: the top N (1–100), null = everyone in the % range; none given = 3 (docs/design/76) */
  top?: number | null;
  /** Toppers: only students whose % (the final, or the subject's when one is picked) is in this range */
  pctFrom?: number | null;
  pctTo?: number | null;
  /** Toppers: the same lists from the bottom */
  lowest?: boolean;
  /** Failing students: the number of subjects failed, from – to (to none = and more; docs/design/77) */
  failFrom?: number | null;
  failTo?: number | null;
  /** Failing students: a student's father / mother mobile ("F 98… · M 97…"), by student id */
  parents?: Record<string, string>;
  /** At-risk: how far above the pass % is borderline */
  margin?: number;
  /** Missing marks, Absent students: one exam's key (none: every exam; docs/design/78) */
  exam?: string;
  /** Attendance (docs/design/79): each pupil's days absent, present and on leave between the dates */
  daily?: Record<string, { a: number; p: number; x: number }>;
  /** Attendance: the dates counted (ISO) */
  from?: string;
  to?: string;
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
/** the register's analysis bands (step 6): in order low to high, the cumulative cut-offs, a %'s band */
function analysisBands(def: RegisterDef) {
  const bands = [...def.analysis.bands].sort((a, b) => b.fromPct - a.fromPct);
  const reach = (p: number, op: '>=' | '>', at: number) => (op === '>' ? p > at : p >= at);
  return {
    ordered: [...bands].reverse(),
    cumulative: def.analysis.cumulative,
    reach,
    bandOf: (p: number) => bands.find((b) => reach(p, b.op, b.fromPct))?.label ?? null,
  };
}

/**
 * Per subject (each language of a slot apart): the students, absent, appeared, the register's % bands,
 * the cumulative counts, highest, lowest, average and passing %. A class with one subject picked: a row
 * per section with its teachers of the subject (each language of a slot apart), then all the sections
 * together, as the legacy's subject-wise analysis. Otherwise (a section, or a class with every subject)
 * the legacy's Result Analysis: the subjects across the top, the figures down the side — a class as one,
 * then each of its sections.
 */
function analysis(i: ReportInput): ReportBlock[] {
  const { ordered, cumulative: cuml, reach, bandOf } = analysisBands(i.def);
  const figureCols: Col[] = [
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
  type Taker = { r: RegStudentResult; x: RegSubjectResult };
  /** the figures of some takers of a subject, from Students to Passing % */
  const figures = (title: string, list: Taker[]): SheetCell[] => {
    const absent = list.filter((y) => y.x.withheld);
    const appeared = list.filter((y) => !y.x.withheld && y.x.pct !== null && !y.x.missing);
    const totals = appeared.map((y) => y.x.total!);
    const max = Math.max(0, ...appeared.map((y) => y.x.max));
    const passed = appeared.filter((y) => y.x.status === 'pass');
    const at = (label: string, l: Taker[]) => count(i, `${title} · ${label}`, l);
    return [
      at('Students', list),
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
  };
  const group = (lead: number) => [
    { t: '', span: lead },
    { t: 'Students in each band', span: ordered.length },
    { t: 'Cumulative', span: cuml.length },
    { t: '', span: 4 },
  ];
  /** a class, one register subject: section by section (each language of a slot apart), then the class */
  const sectionWise = (key: string): ReportBlock | null => {
    const one = i.def.subjects.find((x) => x.key === key);
    const subjects = subjectsOf({ ...i, order: [key] });
    if (!one || !subjects.length) return null;
    const sections = [...new Map(i.rows.map((r) => [r.sectionId, r.section])).entries()];
    const slot = Boolean(one.slot);
    const lead: Col[] = [
      ['Section', 1.3, true],
      ['Teacher', 3, true],
      ...(slot ? [['Subject', 2, true] as Col] : []),
    ];
    const rows: SheetCell[][] = [];
    for (const [sectionId, section] of sections)
      for (const s of subjects) {
        const list = s.list.filter((y) => y.r.sectionId === sectionId);
        if (!list.length) continue;
        rows.push([
          { t: section, text: true, strong: true },
          {
            t: (i.teachers?.[`${sectionId}|${list[0]!.x.subjectId}`] ?? []).join(', '),
            text: true,
          },
          ...(slot ? [{ t: s.label, text: true } as SheetCell] : []),
          ...figures(`${section} · ${s.label}`, list),
        ]);
      }
    for (const s of subjects)
      rows.push([
        { t: 'All sections', text: true, strong: true, tone: 'final' },
        { t: '', tone: 'final' },
        ...(slot ? [{ t: s.label, text: true, tone: 'final' } as SheetCell] : []),
        ...figures(`${i.place} · ${s.label}`, s.list).map((c) => ({ ...c, strong: true })),
      ]);
    const name = slot ? (one.slot?.name ?? one.key) : (i.titles[one.key] ?? one.key);
    return block(
      i,
      `Result analysis — ${name}, section-wise (by the subject’s %)`,
      [...lead, ...figureCols],
      rows,
      group(lead.length + 3),
    );
  };
  /** the legacy's words down the side for the figures' columns */
  const sideLabel: Record<string, string> = {
    Students: 'Total students',
    Highest: 'Highest marks',
    Lowest: 'Lowest marks',
    Average: 'Average marks',
  };
  /**
   * A place's analysis as the legacy's Result Analysis prints it: its subjects across the top (each
   * language of a slot apart), the figures down the side; a count's list names the section when asked.
   */
  const across = (place: string, rows: RegStudentResult[], named: boolean): ReportBlock => {
    const subjects = subjectsOf({ ...i, rows });
    const cols = subjects.map((s) => figures(named ? `${place} · ${s.label}` : s.label, s.list));
    return block(
      i,
      `Result analysis — ${place}`,
      [['Figure', 2.6, true], ...subjects.map((s): Col => [s.label.toUpperCase(), 1.5])],
      figureCols.map(([label], k): SheetCell[] => [
        { t: sideLabel[label] ?? label, text: true, strong: true },
        ...cols.map((c) => c[k]!),
      ]),
    );
  };
  if (i.merit && i.subject) {
    const one = sectionWise(i.subject);
    if (one) return [one];
  }
  if (!i.merit) return [across(i.place, i.rows, false)];
  // a class, every subject: the class as one, then each section, in the same layout
  const sections = [...new Map(i.rows.map((r) => [r.sectionId, r.section])).entries()];
  return [
    across(i.place, i.rows, false),
    ...sections.map(([id, section]) =>
      across(
        section,
        i.rows.filter((r) => r.sectionId === id),
        true,
      ),
    ),
  ];
}

// ---- Entry status ----------------------------------------------------------------------------------
/**
 * The legacy's Marks Entry Status. A section: a row per subject (each member of a slot apart) with its
 * teachers and students, a column per exam — entered of how many with Complete / Partial / Not
 * started, the pending students on a click, "–" where the subject has no such exam — and the share of
 * every subject at the foot. A class: that table for each section in turn (the same exams, so they line
 * up), then its sections against the subjects, the % entered of every exam.
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
  // the exams some subject of the place has: a class's section tables share them
  const exams = i.def.exams.filter((e) => lines.some((l) => l.exams[e.key]));
  /** one section's table, as the legacy prints it */
  const sectionTable = (sectionId: string, section: string): ReportBlock => {
    const classTeacher = i.teachers?.[`${sectionId}|class`]?.join(', ');
    const mine = lines.filter((l) => l.sectionId === sectionId);
    const rows = mine.map((l, n): SheetCell[] => [
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
                  title: `${l.subject}${i.merit ? ` · ${section}` : ''} · ${e.key} · pending`,
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
      `Marks Entry Status — ${section}`,
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
        const of = mine.reduce((a, l) => a + (l.exams[e.key]?.takers.length ?? 0), 0);
        const got = mine.reduce((a, l) => a + (l.exams[e.key]?.done.length ?? 0), 0);
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
    return out;
  };
  if (!i.merit) return [sectionTable(sections[0]?.[0] ?? '', i.place)];
  // a class: each section's table, then the sections against the subjects, the share of every exam
  const subjects = [...new Set(lines.map((l) => l.subject))];
  return [
    ...sections.map(([sectionId, section]) => sectionTable(sectionId, section)),
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

// ---- Missing marks and absentees (docs/design/78) --------------------------------------------------
/** a student's paper of a subject in an exam: the class has the paper and the student takes it */
type Paper = {
  key: string;
  subjectId: string;
  subject: string;
  exam: string;
  st: RegStudent;
  mark: RegMark;
};
/** every paper of the place, in the register's subject order then exam order (the exam picked only) */
function papersOf(i: ReportInput): Paper[] {
  const out: Paper[] = [];
  const exams = i.def.exams.filter((e) => !i.exam || e.key === i.exam);
  for (const k of i.order) {
    const s = i.def.subjects.find((x) => x.key === k);
    if (!s || (i.subject && k !== i.subject)) continue;
    const members = s.slot ? s.slot.members : [s.subjectId ?? ''];
    for (const e of exams)
      for (const m of members)
        for (const st of i.students) {
          const sub = st.subjects.find((x) => x.subjectId === m);
          const mark = sub?.marks[e.key];
          if (!sub || !mark) continue;
          out.push({
            key: k,
            subjectId: m,
            subject: (s.slot ? sub.name : (i.titles[k] ?? k)).toUpperCase(),
            exam: e.key,
            st,
            mark,
          });
        }
  }
  return out;
}
/** a paper with nothing entered: no mark and no code; in parts, the parts not entered (named) */
const missingOf = (p: Paper): string[] | null => {
  if (p.mark.entered) return null;
  if (!p.mark.parts.length) return [];
  const left = p.mark.parts.filter((x) => !x.entered);
  return left.length ? left.map((x) => x.name) : null;
};
/** a paper marked absent: AB on it, or its parts marked absent (named) */
const absentOf = (p: Paper): string[] | null => {
  if ((p.mark.code ?? '').trim().toUpperCase() === 'AB') return [];
  const parts = p.mark.parts.filter((x) => x.absent);
  return parts.length ? parts.map((x) => x.name) : null;
};
const sectionsOf = (i: ReportInput) =>
  [...new Map(i.students.map((s) => [s.sectionId, s.section])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
const byRoll = (a: RegStudent, b: RegStudent) =>
  (a.rollNo ?? Infinity) - (b.rollNo ?? Infinity) || a.name.localeCompare(b.name);
const stName = (i: ReportInput, st: RegStudent) =>
  i.def.display.properCase ? properCase(st.name) : st.name;
const plural = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;
/** the filters a report was made with, for its titles and notes */
const filtersOf = (i: ReportInput) =>
  [i.exam ? `exam ${i.exam}` : 'every exam', i.subject ? (i.titles[i.subject] ?? i.subject) : '']
    .filter(Boolean)
    .join(' · ');
/** a student's papers as "MT1: ENGLISH, SOCIAL SCIENCE (Geography) · TERM: SCIENCE" */
const listOf = (ps: Array<{ p: Paper; parts: string[] }>) => {
  const exams = [...new Set(ps.map((x) => x.p.exam))];
  return exams
    .map(
      (e) =>
        `${e}: ${ps
          .filter((x) => x.p.exam === e)
          .map((x) => `${x.p.subject}${x.parts.length ? ` (${x.parts.join(', ')})` : ''}`)
          .join(', ')}`,
    )
    .join(' · ');
};

/**
 * Missing marks (docs/design/78): who still has a paper with nothing entered — the counts per section
 * and exam, then per section a line per subject × exam with its teacher, missing / takers and the names.
 */
function missing(i: ReportInput): ReportBlock[] {
  const all = papersOf(i);
  const miss = all
    .map((p) => ({ p, parts: missingOf(p) }))
    .filter((x): x is { p: Paper; parts: string[] } => x.parts !== null);
  const exams = i.def.exams.filter((e) => all.some((p) => p.exam === e.key));
  const sections = sectionsOf(i);
  const what = filtersOf(i);
  const drillOf = (title: string, list: typeof miss): SheetCell => {
    const who = [...new Set(list.map((x) => x.p.st))].sort(byRoll);
    if (!list.length) return { t: '0', center: true };
    // the screen and the files print the same: the papers and their students
    return {
      t: `${plural(list.length, 'paper')} · ${plural(who.length, 'student')}`,
      center: true,
      strong: true,
      drill: {
        title,
        cols: ['#', 'Name', 'Adm No', ...(i.merit ? ['Section'] : []), 'Missing'],
        rows: who.map((st, n) => [
          String(n + 1),
          stName(i, st),
          st.admissionNo,
          ...(i.merit ? [st.section] : []),
          listOf(list.filter((x) => x.p.st === st)),
        ]),
      },
    };
  };
  const places: Array<[string, string]> = i.merit
    ? [...sections, ['', 'Class']]
    : sections.slice(0, 1).map(([id]) => [id, i.place]);
  const counts = block(
    i,
    `Missing marks — ${i.place} (papers with nothing entered)`,
    [['Section', 1.6, true], ...exams.map((e): Col => [e.key, 1.6]), ['Total', 1.4]],
    places.map(([id, label]): SheetCell[] => {
      const mine = id ? miss.filter((x) => x.p.st.sectionId === id) : miss;
      const look = i.merit && !id ? { tone: 'final' as const } : {};
      return [
        { t: label, text: true, strong: true, ...look },
        ...exams.map((e): SheetCell => ({
          ...drillOf(
            `${label} · ${e.key} · missing`,
            mine.filter((x) => x.p.exam === e.key),
          ),
          ...look,
        })),
        { ...drillOf(`${label} · missing`, mine), ...look },
      ];
    }),
  );
  for (const h of counts.sheet.head[0]!.slice(1)) h.center = true;
  counts.sheet.note = `${what} · the papers missing and their students (click for the names) · Missing = no mark and no code; a code (AB, ML …) counts as entered`;
  const out: ReportBlock[] = [counts];
  for (const [sectionId, section] of sections) {
    const mine = miss.filter((x) => x.p.st.sectionId === sectionId);
    // a line per subject × exam with anything missing, in the papers' order
    const lines: Array<{ key: string; subjectId: string; subject: string; exam: string }> = [];
    for (const x of mine)
      if (!lines.some((l) => l.subjectId === x.p.subjectId && l.exam === x.p.exam))
        lines.push({
          key: x.p.key,
          subjectId: x.p.subjectId,
          subject: x.p.subject,
          exam: x.p.exam,
        });
    const rows = lines.map((l, n): SheetCell[] => {
      const takers = all.filter(
        (p) => p.st.sectionId === sectionId && p.subjectId === l.subjectId && p.exam === l.exam,
      );
      const left = mine
        .filter((x) => x.p.subjectId === l.subjectId && x.p.exam === l.exam)
        .sort((a, b) => byRoll(a.p.st, b.p.st));
      return [
        { t: String(n + 1), center: true },
        { t: l.subject, text: true, strong: true },
        { t: l.exam, center: true },
        {
          t: (i.teachers?.[`${sectionId}|${l.subjectId}`] ?? []).join(', ') || 'no teacher mapped',
          text: true,
        },
        {
          t: `${String(left.length)} / ${String(takers.length)}`,
          center: true,
          strong: true,
          tone: 'code',
        },
        {
          t: left
            .map(
              (x) =>
                `${x.p.st.rollNo === null ? '' : `${String(x.p.st.rollNo)} `}${stName(i, x.p.st)}${x.parts.length ? ` (${x.parts.join(', ')})` : ''}`,
            )
            .join(', '),
          text: true,
          wrap: true,
        },
      ];
    });
    const b = block(
      i,
      `Missing marks — ${section}`,
      [
        ['#', 0.5],
        ['Subject', 2.6, true],
        ['Exam', 1.2],
        ['Teacher', 3, true],
        ['Missing / takers', 1.6],
        ['Students', 9, true],
      ],
      rows.length
        ? rows
        : [
            [
              { t: '' },
              { t: 'Nothing missing', text: true, strong: true },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
            ],
          ],
    );
    for (const h of b.sheet.head[0]!)
      if (['#', 'Exam', 'Missing / takers'].includes(h.t)) h.center = true;
    const ct = i.teachers?.[`${sectionId}|class`]?.join(', ');
    b.sheet.note = [what, ...(ct ? [`Class teacher: ${ct}`] : [])].join(' · ');
    out.push(b);
  }
  return out;
}

/**
 * Absentees (docs/design/78): AB on a paper, or a part marked absent — the counts per section and exam,
 * then per section a line per absent student with the parents' mobiles, the class teacher and where.
 */
function absent(i: ReportInput): ReportBlock[] {
  const all = papersOf(i);
  const abs = all
    .map((p) => ({ p, parts: absentOf(p) }))
    .filter((x): x is { p: Paper; parts: string[] } => x.parts !== null);
  const exams = i.def.exams.filter((e) => all.some((p) => p.exam === e.key));
  const sections = sectionsOf(i);
  const what = filtersOf(i);
  const drillOf = (title: string, list: typeof abs): SheetCell => {
    const who = [...new Set(list.map((x) => x.p.st))].sort(byRoll);
    if (!who.length) return { t: '0', center: true };
    return {
      t: String(who.length),
      center: true,
      strong: true,
      drill: {
        title,
        cols: ['#', 'Name', 'Adm No', ...(i.merit ? ['Section'] : []), 'Absent in'],
        rows: who.map((st, n) => [
          String(n + 1),
          stName(i, st),
          st.admissionNo,
          ...(i.merit ? [st.section] : []),
          listOf(list.filter((x) => x.p.st === st)),
        ]),
      },
    };
  };
  const places: Array<[string, string]> = i.merit
    ? [...sections, ['', 'Class']]
    : sections.slice(0, 1).map(([id]) => [id, i.place]);
  const counts = block(
    i,
    `Absent — ${i.place} (students marked AB)`,
    [
      ['Section', 1.6, true],
      ...exams.map((e): Col => [e.key, 1.4]),
      ['Students', 1.3],
      ['Papers', 1.2],
    ],
    places.map(([id, label]): SheetCell[] => {
      const mine = id ? abs.filter((x) => x.p.st.sectionId === id) : abs;
      const look = i.merit && !id ? { tone: 'final' as const } : {};
      return [
        { t: label, text: true, strong: true, ...look },
        ...exams.map((e): SheetCell => ({
          ...drillOf(
            `${label} · ${e.key} · absent`,
            mine.filter((x) => x.p.exam === e.key),
          ),
          ...look,
        })),
        { ...drillOf(`${label} · absent`, mine), ...look },
        { t: String(mine.length), center: true, ...look },
      ];
    }),
  );
  for (const h of counts.sheet.head[0]!.slice(1)) h.center = true;
  counts.sheet.note = `${what} · a count is the students absent (click for the names) · Absent = AB on a paper, or a part marked absent`;
  const out: ReportBlock[] = [counts];
  for (const [sectionId, section] of sections) {
    const mine = abs.filter((x) => x.p.st.sectionId === sectionId);
    const who = [...new Set(mine.map((x) => x.p.st))].sort(byRoll);
    const ct = (i.teachers?.[`${sectionId}|class`] ?? []).join(', ');
    const rows = who.map((st): SheetCell[] => {
      const ps = mine.filter((x) => x.p.st === st);
      return [
        { t: st.rollNo === null ? '' : String(st.rollNo), center: true },
        { t: stName(i, st), text: true, strong: true },
        { t: st.admissionNo, center: true },
        { t: i.parents?.[st.studentId] ?? '', text: true },
        { t: ct, text: true },
        { t: listOf(ps), text: true, wrap: true },
        { t: String(ps.length), center: true, strong: true, tone: 'code' },
      ];
    });
    const b = block(
      i,
      `Absent — ${section}${who.length ? ` (${plural(who.length, 'student')})` : ''}`,
      [
        ['Roll', 0.8],
        ['Student', 3.2, true],
        ['Adm No', 1.5],
        ['Parent mobile', 2.8, true],
        ['Class teacher', 2.4, true],
        ['Absent in', 7, true],
        ['Papers', 1],
      ],
      rows.length
        ? rows
        : [
            [
              { t: '' },
              { t: 'Nobody absent', text: true, strong: true },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
            ],
          ],
    );
    for (const h of b.sheet.head[0]!)
      if (['Roll', 'Adm No', 'Papers'].includes(h.t)) h.center = true;
    b.sheet.note = what;
    out.push(b);
  }
  return out;
}

// ---- Attendance (docs/design/79) -------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-06 → 06-Oct-2026 */
const dMonY = (iso: string | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]!}-${MONTHS[Number(m[2]) - 1] ?? m[2]!}-${m[1]!}` : (iso ?? '');
};

/**
 * Attendance between two dates (docs/design/79), as the old Attendance Report: a table per section, every
 * pupil by roll with A (absent), P (present: every mark but A and LV), X (on leave), Total = A + P + X
 * and % = P × 100 ÷ (Total − X); a pupil with nothing marked shows 0s and no %.
 */
function attendance(i: ReportInput): ReportBlock[] {
  const range = `${dMonY(i.from)} to ${dMonY(i.to)}`;
  return sectionsOf(i).map(([sectionId, section]) => {
    const pupils = i.students.filter((st) => st.sectionId === sectionId).sort(byRoll);
    const rows = pupils.map((st, n): SheetCell[] => {
      const d = i.daily?.[st.studentId] ?? { a: 0, p: 0, x: 0 };
      const total = d.a + d.p + d.x;
      const of = total - d.x;
      return [
        { t: String(n + 1), center: true },
        { t: section, center: true },
        { t: st.rollNo === null ? '' : String(st.rollNo), center: true },
        { t: st.admissionNo, center: true },
        { t: stName(i, st), text: true, strong: true },
        { t: String(d.a), center: true, ...(d.a ? { tone: 'code' as const } : {}) },
        { t: String(d.p), center: true },
        { t: String(d.x), center: true },
        { t: String(total), center: true, tone: 'calc' },
        { t: of > 0 ? pctOf((d.p * 100) / of) : '', center: true, tone: 'final', strong: true },
      ];
    });
    const b = block(
      i,
      `Attendance — ${section} · ${range}`,
      [
        ['SRN', 0.7],
        ['Class', 1.3],
        ['Roll No', 0.9],
        ['Student ID', 1.5],
        ['Name', 4, true],
        ['A', 0.8],
        ['P', 0.8],
        ['X', 0.8],
        ['Total', 0.9],
        ['%', 1.1],
      ],
      rows.length
        ? rows
        : [
            [
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: 'No pupils', text: true },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
              { t: '' },
            ],
          ],
    );
    for (const h of b.sheet.head[0]!) if (h.t !== 'Name') h.center = true;
    b.sheet.head[0]![9]!.title = '(P × 100) ÷ (Total − X)';
    const marked = pupils.filter((st) => {
      const d = i.daily?.[st.studentId];
      return d && d.a + d.p + d.x > 0;
    }).length;
    b.sheet.note = [
      'A = absent',
      'P = present (late, short leave, half day, on duty and stay back count as present)',
      'X = on leave',
      'Total = A + P + X',
      '% = P × 100 ÷ (Total − X)',
      ...(marked < pupils.length
        ? [`${plural(pupils.length - marked, 'pupil')} with nothing marked: 0s, no %`]
        : []),
    ].join(' · ');
    return b;
  });
}

// ---- Toppers ---------------------------------------------------------------------------------------
/** a % as the legacy prints it: up to two decimals, trailing zeros dropped (100%, 97.44%, 81.9%) */
const pctOf = (v: number | null) => {
  if (v === null) return '';
  return `${String(Math.round(v * 100) / 100)}%`;
};

/**
 * The legacy's Toppers: "Overall Toppers — Top N · by Final Total" (position, student, admission no,
 * final total, %, grade; every tie at the last position shown), each section's top N in a class, then
 * "Subject Toppers": every subject's highest marks with all ties, "Full marks" marked. docs/design/76:
 * N is any number (none = everyone in the range); a % range keeps the students whose % is in it before
 * the top N is taken; **lowest** gives the same lists from the bottom; a subject picked gives that
 * subject's own toppers (by its %) for the class and each section, each language of a slot apart, of
 * everyone with marks in it. Positions are competition positions (1, 1, 3) within each list.
 */
function toppers(i: ReportInput): ReportBlock[] {
  const n = i.top === undefined ? 3 : i.top;
  const low = Boolean(i.lowest);
  const from = i.pctFrom ?? null;
  const to = i.pctTo ?? null;
  const inRange = (p: number | null) =>
    p !== null && (from === null || p >= from - 1e-9) && (to === null || p <= to + 1e-9);
  const rangeText =
    from === null && to === null
      ? ''
      : ` · ${cutFixed(from ?? 0, 'auto')}%–${cutFixed(to ?? 100, 'auto')}%`;
  /** "Top 5 of VIII-A", "Lowest 5 of the class", "All of VIII-A, lowest first" */
  const head = (where: string) =>
    (n === null
      ? `All ${where}${low ? ', lowest first' : ''}`
      : `${low ? 'Lowest' : 'Top'} ${String(n)} ${where}`
    )
      .replace(/\s+,/, ',')
      .trim();
  /**
   * The first N of a pool by a value, highest first (or lowest), with competition positions; every one
   * tied at the last position is kept.
   */
  const pick = <T>(pool: T[], value: (x: T) => number, tie: (x: T) => string) => {
    const sorted = [...pool].sort(
      (a, b) => (low ? value(a) - value(b) : value(b) - value(a)) || tie(a).localeCompare(tie(b)),
    );
    const out: Array<{ x: T; at: number }> = [];
    let at = 0;
    sorted.forEach((x, k) => {
      if (k === 0 || Math.abs(value(x) - value(sorted[k - 1]!)) > 1e-9) at = k + 1;
      if (n === null || at <= n) out.push({ x, at });
    });
    return out;
  };
  const position = (at: number): SheetCell => ({
    t: '',
    center: true,
    badge: { label: String(at), tone: low ? 'warning' : 'info' },
  });
  const nobody = (cols: Col[]): SheetCell[][] => [
    [
      {
        t: from === null && to === null ? 'Nobody to list' : 'Nobody in this range',
        text: true,
        span: cols.length,
      },
    ],
  ];
  const amber = (b: ReportBlock) => {
    for (const h of b.sheet.head[0]!.slice(-3)) h.tone = 'final';
    for (const h of b.sheet.head[0]!)
      if (h.t !== 'Student Name' && h.t !== 'Section') h.center = true;
    return b;
  };
  const sectionsOf = () => [...new Set(i.rows.map((r) => r.section))].sort();

  // a subject picked: its own toppers, the class and each section (each language of a slot apart)
  if (i.subject) {
    const cols: Col[] = [
      ['Position', 1, true],
      ['Student Name', 4, true],
      ...(i.merit ? [['Section', 1.2, true] as Col] : []),
      ['Adm No', 1.8],
      ['Marks', 2],
      ['%', 1.4],
      ['Grade', 1.1],
    ];
    type Taker = { r: RegStudentResult; x: RegSubjectResult };
    const table = (title: string, takers: Taker[]) => {
      const pool = takers.filter(
        (y) =>
          !y.x.withheld && !y.x.missing && y.x.total !== null && y.x.max > 0 && inRange(y.x.pct),
      );
      const rows = pick(
        pool,
        (y) => y.x.pct!,
        (y) => y.r.name,
      ).map(({ x: y, at }): SheetCell[] => {
        const full = !low && Math.abs(y.x.total! - y.x.max) < 1e-9;
        return [
          position(at),
          {
            t: nameOf(i, y.r),
            text: true,
            strong: true,
            ...(full ? { badge: { label: 'Full marks', tone: 'success' as const } } : {}),
          },
          ...(i.merit ? [{ t: y.r.section, text: true } as SheetCell] : []),
          { t: y.r.admissionNo, center: true },
          {
            t: `${cutFixed(y.x.total!, 'auto')} / ${cutFixed(y.x.max, 'auto')}`,
            tone: 'final',
            center: true,
            ratio: true,
          },
          { t: pctOf(y.x.pct), tone: 'final', center: true, strong: true },
          { t: y.x.grade ?? '', tone: 'final', center: true, strong: true },
        ];
      });
      return amber(block(i, title, cols, rows.length ? rows : nobody(cols)));
    };
    const out: ReportBlock[] = [];
    for (const s of subjectsOf({ ...i, order: [i.subject] })) {
      const what = `${s.label} ${low ? '—' : 'toppers —'}`;
      out.push(
        table(
          `${what} ${head(`of ${i.merit ? 'the class' : i.place}`)} · by the subject’s %${rangeText}`,
          s.list,
        ),
      );
      if (i.merit)
        for (const sec of sectionsOf()) {
          const mine = s.list.filter((y) => y.r.section === sec);
          if (mine.length)
            out.push(table(`${what} ${head(`of ${sec}`)} · by the subject’s %${rangeText}`, mine));
        }
    }
    return out;
  }

  // every subject: the final, the class (or section) and each section, then each subject's highest
  const byPct = i.def.final.rankBy === 'pct';
  const by = byPct ? 'Final %' : 'Final Total';
  const cols: Col[] = [
    ['Position', 1, true],
    ['Student Name', 4, true],
    ...(i.merit ? [['Section', 1.2, true] as Col] : []),
    ['Adm No', 1.8],
    ['Final Total', 2],
    ['%', 1.4],
    ['Grade', 1.1],
  ];
  // toppers: who passed; the lowest: everyone with a final (pass, compartment or fail)
  const pool = i.rows.filter(
    (r) =>
      r.total !== null &&
      (low ? ['pass', 'compartment', 'fail'].includes(r.result) : r.result === 'pass') &&
      inRange(r.pct),
  );
  const finalTable = (title: string, rows: RegStudentResult[]) => {
    const lines = pick(
      rows,
      (r) => (byPct ? (r.pct ?? 0) : r.total!),
      (r) => r.name,
    ).map(({ x: r, at }): SheetCell[] => [
      position(at),
      { t: nameOf(i, r), text: true, strong: true },
      ...(i.merit ? [{ t: r.section, text: true } as SheetCell] : []),
      { t: r.admissionNo, center: true },
      {
        t: `${cutFixed(r.total!, 'auto')} / ${cutFixed(r.max, 'auto')}`,
        tone: 'final',
        center: true,
        ratio: true,
      },
      { t: r.pct === null ? '' : pctOf(r.pct), tone: 'final', center: true, strong: true },
      { t: r.grade ?? '', tone: 'final', center: true, strong: true },
    ]);
    return amber(block(i, title, cols, lines.length ? lines : nobody(cols)));
  };
  const out = [
    finalTable(
      `${low ? 'Overall' : 'Overall Toppers'} — ${head(i.merit ? 'of the class' : '')} · by ${by}${rangeText}`,
      pool,
    ),
  ];
  if (i.merit)
    for (const sec of sectionsOf())
      out.push(
        finalTable(
          `${head(`of ${sec}`)} · by ${by}${rangeText}`,
          pool.filter((r) => r.section === sec),
        ),
      );
  // every subject's highest (or lowest), every one tied at it
  const rows: SheetCell[][] = [];
  for (const s of subjectsOf(i)) {
    const ok = s.list.filter(
      (y) => !y.x.withheld && y.x.total !== null && !y.x.missing && y.x.max > 0 && inRange(y.x.pct),
    );
    if (!ok.length) continue;
    const edge = low
      ? Math.min(...ok.map((y) => y.x.total!))
      : Math.max(...ok.map((y) => y.x.total!));
    const top = ok
      .filter((y) => Math.abs(y.x.total! - edge) < 1e-9)
      .sort((a, b) => a.r.name.localeCompare(b.r.name));
    for (const [k, y] of top.entries()) {
      const full = !low && Math.abs(y.x.total! - y.x.max) < 1e-9;
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
  const subjectCols: Col[] = [
    ['Subject', 3, true],
    [low ? 'Lowest' : 'Topper', 5, true],
    ...(i.merit ? [['Section', 1.2, true] as Col] : []),
    ['Adm No', 1.8],
    ['Marks', 1.8],
    ['%', 1.4],
  ];
  const subjects = block(
    i,
    `${low ? 'Lowest in each subject' : 'Subject Toppers — highest in each subject'} (all ties shown)${rangeText}`,
    subjectCols,
    rows.length ? rows : nobody(subjectCols),
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
/**
 * Failing students (docs/design/77): students with a final worked out (Compartment / Fail), kept by the
 * number of subjects failed (from – to) and the final % (from – to), and by a subject picked (those
 * failing it). First the counts — sections and the class against Failed in 1 / 2 / 3 / 4 / 5+, then each
 * subject against the sections — then a table per number failed: a line per student with the parents'
 * mobiles, the class teacher, every subject's marks (the failed ones in red), the final and the
 * teachers of the failed subjects.
 */
function failing(i: ReportInput): ReportBlock[] {
  const from = Math.max(1, i.failFrom ?? 1);
  const to = i.failTo ?? null;
  const pFrom = i.pctFrom ?? null;
  const pTo = i.pctTo ?? null;
  const inPct = (p: number | null) =>
    p !== null && (pFrom === null || p >= pFrom - 1e-9) && (pTo === null || p <= pTo + 1e-9);
  const inCount = (n: number) => n >= from && (to === null || n <= to);
  /** the subjects a student failed that count in the final (register key and result) */
  const failedOf = (r: RegStudentResult) =>
    Object.entries(r.subjects).filter(
      (e): e is [string, RegSubjectResult] => !!e[1] && e[1].inFinal && e[1].status === 'fail',
    );
  const sections = [...new Set(i.rows.map((r) => r.section))].sort();
  // with a final, failing, in the % range, failing the subject picked
  const base = i.rows.filter(
    (r) =>
      (r.result === 'compartment' || r.result === 'fail') &&
      inPct(r.pct) &&
      failedOf(r).length > 0 &&
      (!i.subject || failedOf(r).some(([k]) => k === i.subject)),
  );
  const listed = base.filter((r) => inCount(failedOf(r).length));
  const filters = [
    `failing in ${to === null ? `${String(from)} or more` : from === to ? String(from) : `${String(from)}–${String(to)}`} subject${to === 1 ? '' : 's'}`,
    pFrom !== null || pTo !== null
      ? `final ${cutFixed(pFrom ?? 0, 'auto')}%–${cutFixed(pTo ?? 100, 'auto')}%`
      : '',
    i.subject ? `failing ${i.titles[i.subject] ?? i.subject}` : '',
  ].filter(Boolean);
  const out: ReportBlock[] = [];

  // the counts: sections and the class against the number of subjects failed
  const buckets = [1, 2, 3, 4, 5];
  const bucketOf = (n: number) => Math.min(n, 5);
  const places = i.merit ? [...sections, 'Class'] : sections;
  const counts = block(
    i,
    'Students failing — by the number of subjects failed',
    [
      ['Section', 1.6, true],
      ...buckets.map((b): Col => [b === 5 ? 'Failed in 5+' : `Failed in ${String(b)}`, 1.3]),
      ['Total', 1.2],
    ],
    places.map((p): SheetCell[] => {
      const mine = p === 'Class' ? base : base.filter((r) => r.section === p);
      const cls = p === 'Class';
      const look = cls ? { tone: 'final' as const, strong: true } : {};
      return [
        { t: p, text: true, strong: true, ...look },
        ...buckets.map((b): SheetCell => ({
          ...count(
            i,
            `${p} · failed in ${b === 5 ? '5 or more' : String(b)}`,
            mine.filter((r) => bucketOf(failedOf(r).length) === b).map((r) => ({ r })),
          ),
          center: true,
          ...look,
        })),
        {
          ...count(
            i,
            `${p} · failing`,
            mine.map((r) => ({ r })),
          ),
          center: true,
          ...look,
        },
      ];
    }),
  );
  // the count range's columns marked
  for (const [k, b] of buckets.entries()) {
    const h = counts.sheet.head[0]![k + 1]!;
    h.center = true;
    if (b === 5 ? to === null || to >= 5 : inCount(b)) h.tone = 'final';
  }
  counts.sheet.head[0]![buckets.length + 1]!.center = true;
  counts.sheet.note = `Students with a final worked out (Compartment / Fail); ${filters.join(' · ')}; the shaded columns are the range listed below`;
  out.push(counts);

  // each subject: how many failed it, by section and the class
  const subjectRows = subjectsOf(i).map((s): SheetCell[] => [
    { t: s.label.toUpperCase(), text: true, strong: true },
    ...places.map((p): SheetCell => {
      const cls = p === 'Class';
      return {
        ...count(
          i,
          `${p} · failed ${s.label}`,
          s.list.filter(
            (y) =>
              base.includes(y.r) &&
              (cls || y.r.section === p) &&
              y.x.inFinal &&
              y.x.status === 'fail',
          ),
        ),
        center: true,
        ...(cls ? { tone: 'final' as const, strong: true } : {}),
      };
    }),
  ]);
  const bySubject = block(
    i,
    'Students failing — by subject',
    [['Subject', 3, true], ...places.map((p): Col => [p, 1.3])],
    subjectRows,
  );
  for (const h of bySubject.sheet.head[0]!.slice(1)) h.center = true;
  if (i.merit) bySubject.sheet.head[0]![places.length]!.tone = 'final';
  out.push(bySubject);

  // a table per number of subjects failed: a line per student with every subject's marks
  // the register's subjects someone listed takes (the tables share them, so they line up)
  const subjectKeys = i.order.filter(
    (k) => i.def.subjects.some((x) => x.key === k) && listed.some((r) => r.subjects[k]),
  );
  const cols: Col[] = [
    ...(i.merit ? [['Section', 1.1, true] as Col] : []),
    ['Roll', 0.8],
    ['Student', 3.4, true],
    ['Adm No', 1.5],
    ['Parent mobile', 2.8, true],
    ['Class teacher', 2.4, true],
    ...subjectKeys.map((k): Col => [(i.titles[k] ?? k).toUpperCase(), 1.6]),
    ['Final total', 1.7],
    ['%', 1],
    ['Result', 1.5],
    ['Teachers of the failed subjects', 4.5, true],
  ];
  const line = (r: RegStudentResult): SheetCell[] => {
    const failed = failedOf(r);
    return [
      ...(i.merit ? [{ t: r.section, text: true } as SheetCell] : []),
      { t: r.rollNo === null ? '' : String(r.rollNo), center: true },
      { t: nameOf(i, r), text: true, strong: true },
      { t: r.admissionNo, center: true },
      { t: i.parents?.[r.studentId] ?? '', text: true },
      { t: (i.teachers?.[`${r.sectionId}|class`] ?? []).join(', '), text: true },
      ...subjectKeys.map((k): SheetCell => {
        const x = r.subjects[k];
        if (!x) return { t: '—', center: true, tone: 'none' };
        const slot = Boolean(i.def.subjects.find((s) => s.key === k)?.slot);
        const marks =
          x.total === null ? '' : `${cutFixed(x.total, 'auto')} / ${cutFixed(x.max, 'auto')}`;
        const fail = x.inFinal && x.status === 'fail';
        return {
          t: slot ? `${x.code} ${marks}`.trim() : marks,
          center: true,
          ...(fail ? { tone: 'code' as const, title: `Failed ${x.name}` } : {}),
        };
      }),
      {
        t: r.total === null ? '' : `${cutFixed(r.total, 'auto')} / ${cutFixed(r.max, 'auto')}`,
        tone: 'final',
        center: true,
        ratio: true,
      },
      { t: r.pct === null ? '' : pctOf(r.pct), tone: 'final', center: true },
      { t: RESULT[r.result], tone: 'final', text: true, strong: true },
      {
        t: failed
          .map(
            ([, x]) =>
              `${x.code} – ${(i.teachers?.[`${r.sectionId}|${x.subjectId}`] ?? []).join(', ') || 'no teacher mapped'}`,
          )
          .join(' · '),
        text: true,
      },
    ];
  };
  const order = (a: RegStudentResult, b: RegStudentResult) =>
    a.section.localeCompare(b.section) ||
    (a.rollNo ?? Infinity) - (b.rollNo ?? Infinity) ||
    a.name.localeCompare(b.name);
  const numbers = [...new Set(listed.map((r) => failedOf(r).length))].sort((a, b) => a - b);
  for (const n of numbers) {
    const of = listed.filter((r) => failedOf(r).length === n).sort(order);
    const b = block(
      i,
      `Failed in ${String(n)} subject${n === 1 ? '' : 's'} — ${String(of.length)} student${of.length === 1 ? '' : 's'}`,
      cols,
      of.map(line),
    );
    for (const h of b.sheet.head[0]!)
      if (
        ![
          'Student',
          'Parent mobile',
          'Class teacher',
          'Teachers of the failed subjects',
          'Section',
        ].includes(h.t)
      )
        h.center = true;
    for (const h of b.sheet.head[0]!.slice(-4, -1)) h.tone = 'final';
    out.push(b);
  }
  if (!numbers.length)
    out.push(
      block(
        i,
        'Students failing',
        [['Students', 10, true]],
        [[{ t: `Nobody ${filters.join(' · ')}`, text: true }]],
      ),
    );
  return out;
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
    const bestAvg = Math.max(
      ...per
        .slice(0, sections.length)
        .map((x) => (x.avg === null ? -1 : Math.round(x.avg * 100) / 100)),
    );
    return [
      { t: s.label.toUpperCase(), text: true, strong: true },
      ...per.flatMap((x, n): SheetCell[] => {
        const cls = n === places.length - 1;
        const top =
          !cls &&
          sections.length > 1 &&
          x.avg !== null &&
          Math.abs(Math.round(x.avg * 100) / 100 - bestAvg) < 1e-9;
        const base = { center: true, ...(cls ? { tone: 'final' as const, strong: true } : {}) };
        return [
          {
            ...base,
            t: x.avg === null ? '' : `${pctOf(x.avg)}${top ? ' ▲' : ''}`,
            ...(top ? { strong: true } : {}),
          },
          { ...base, t: x.pass === null ? '' : pctOf(x.pass) },
          { ...base, t: x.high === null ? '' : cutFixed(x.high, 'auto') },
        ];
      }),
    ];
  });
  // the legacy's "Overall result": a column per section and the class, the best section marked ▲
  const overall = places.map((p) => {
    const list = p === 'Class' ? i.rows : i.rows.filter((r) => r.section === p);
    const appeared = list.filter((r) => ['pass', 'compartment', 'fail'].includes(r.result));
    const passed = appeared.filter((r) => r.result === 'pass');
    return {
      list,
      appeared,
      avg: appeared.length ? avg(appeared.map((r) => r.pct ?? 0)) : null,
      pass: appeared.length ? (passed.length / appeared.length) * 100 : null,
      compartment: list.filter((r) => r.result === 'compartment').length,
      fail: list.filter((r) => r.result === 'fail').length,
    };
  });
  const isClass = (n: number) => n === places.length - 1;
  const best = (pick: (o: (typeof overall)[number]) => number | null) => {
    const vals = overall.slice(0, sections.length).map(pick);
    const top = Math.max(...vals.map((v) => v ?? -1));
    return (n: number) =>
      sections.length > 1 && !isClass(n) && vals[n] !== null && Math.abs(vals[n]! - top) < 1e-9;
  };
  const bestAvg = best((o) => (o.avg === null ? null : Math.round(o.avg * 100) / 100));
  const bestPass = best((o) => (o.pass === null ? null : Math.round(o.pass * 100) / 100));
  const cell = (t: string, n: number, top = false): SheetCell => ({
    t: top ? `${t} ▲` : t,
    center: true,
    ...(top || isClass(n) ? { strong: true } : {}),
    ...(isClass(n) ? { tone: 'final' as const } : {}),
  });
  const upTo = i.def.final.compartmentUpTo;
  // the legacy's Result Analysis figures, on the final total and its %, a column per section
  const { ordered, cumulative, reach, bandOf } = analysisBands(i.def);
  const counted = (label: string, pick: (o: (typeof overall)[number]) => RegStudentResult[]) => [
    { t: label, text: true, strong: true },
    ...overall.map((o, n): SheetCell => {
      const c = count(
        i,
        `${places[n]!} · ${label}`,
        pick(o).map((r) => ({ r })),
      );
      return {
        ...c,
        center: true,
        ...(isClass(n) ? { tone: 'final' as const, strong: true } : {}),
      };
    }),
  ];
  const finals = (o: (typeof overall)[number]) => o.appeared.filter((r) => r.total !== null);
  const overallRows: SheetCell[][] = [
    counted('Total students', (o) => o.list),
    counted('Absent (final withheld)', (o) => o.list.filter((r) => r.result === 'absent')),
    counted('Appeared', (o) => o.appeared),
    ...ordered.map((b) =>
      counted(b.label, (o) =>
        o.appeared.filter((r) => r.pct !== null && bandOf(r.pct) === b.label),
      ),
    ),
    ...cumulative.map((c) =>
      counted(`${c.op}${String(c.pct)}%`, (o) =>
        o.appeared.filter((r) => r.pct !== null && reach(r.pct, c.op, c.pct)),
      ),
    ),
    [
      { t: 'Highest marks', text: true, strong: true },
      ...overall.map((o, n) => {
        const f = finals(o);
        return cell(
          f.length
            ? `${cutFixed(Math.max(...f.map((r) => r.total!)), 'auto')} / ${cutFixed(Math.max(...f.map((r) => r.max)), 'auto')}`
            : '',
          n,
        );
      }),
    ],
    [
      { t: 'Lowest marks', text: true, strong: true },
      ...overall.map((o, n) => {
        const f = finals(o);
        return cell(f.length ? cutFixed(Math.min(...f.map((r) => r.total!)), 'auto') : '', n);
      }),
    ],
    [
      { t: 'Average marks', text: true, strong: true },
      ...overall.map((o, n) => {
        const f = finals(o);
        return cell(f.length ? cutFixed(avg(f.map((r) => r.total!))!, 2) : '', n);
      }),
    ],
    [
      { t: 'Average Final %', text: true, strong: true },
      ...overall.map((o, n) => cell(pctOf(o.avg), n, bestAvg(n))),
    ],
    [
      { t: 'Pass % (Result PASS ÷ appeared)', text: true, strong: true },
      ...overall.map((o, n) => cell(pctOf(o.pass), n, bestPass(n))),
    ],
    [
      {
        t: `Compartment (${upTo === 1 ? '1' : `1–${String(upTo)}`} failed)`,
        text: true,
        strong: true,
      },
      ...overall.map((o, n) => cell(String(o.compartment), n)),
    ],
    [
      { t: `Fail (more than ${String(upTo)} failed)`, text: true, strong: true },
      ...overall.map((o, n) => cell(String(o.fail), n)),
    ],
  ];
  const head = block(
    i,
    'Overall result',
    [['Overall result', 3, true], ...places.map((p): Col => [p, 1.3])],
    overallRows,
  );
  for (const [n, h] of head.sheet.head[0]!.entries()) {
    if (n > 0) h.center = true;
    if (n === places.length) h.tone = 'final';
  }
  head.band = false;
  head.sheet.note =
    'Total students, absent, appeared, the % bands, the cumulative counts and the highest, lowest and average marks: the final total and its %; appeared = a final worked out (pass, compartment or fail)';
  const bySubject = block(i, 'Section comparison by subject (▲ the best section)', cols, rows, [
    { t: '', span: 1 },
    ...places.map((p) => ({ t: p, span: 3 })),
  ]);
  for (const row of bySubject.sheet.head)
    for (const h of row) if (h.t !== 'Subject') h.center = true;
  const top = bySubject.sheet.head[0]!;
  top[top.length - 1]!.tone = 'final';
  for (const h of bySubject.sheet.head[1]!.slice(-3)) h.tone = 'final';
  return [head, bySubject];
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
    case 'missing':
      return missing(i);
    case 'absent':
      return absent(i);
    case 'attendance':
      return attendance(i);
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
