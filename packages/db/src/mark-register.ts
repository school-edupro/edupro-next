/**
 * Mark registers (docs/design/68): the school's Term Mark Register as one engine. A register reads some
 * exams (by a short key) and builds, per subject, a chain of columns: an exam's marks (or one of its
 * parts), an average (all, best N, or a sum) of other columns, a conversion (scale to a maximum, or a
 * weightage %), or marks for attendance by slabs. The ticked columns make the subject's total (a column
 * another ticked column is made from drops out, so the total is counted once); the counted subjects
 * make the final, its %, grade, division, result and a competition rank. Mark codes follow the
 * register's rule for each exam (count 0, leave out of the maximum, fixed or % marks, pro-rata from
 * other columns), and a blocking code withholds the subject and the final.
 *
 * Pure functions with no imports: the API loads the marks and works them out here, and the admin
 * builder runs the same file (copied by scripts/sync-mark-register.mjs) for its preview.
 */

/** none: as it is (2 decimals) · keep: whole, an exact .5 kept · up: whole, .5 up */
export type RegRound = 'none' | 'keep' | 'up';
export type CodeTreat = 'zero' | 'excl' | 'fixed' | 'pctmax' | 'prorata';

export interface RegCode {
  code: string;
  meaning: string;
  treat: CodeTreat;
  /** fixed: the marks; pctmax: the % of the maximum */
  amt?: number | null;
  /** withholds the subject and the final ("–") */
  blocks: boolean;
  /** print the value the code was replaced with, marked "*" */
  showValue: boolean;
  /** pro-rata: the share given (100 = the full proportion) */
  prPct?: number | null;
}

export type RegColumnKind = 'raw' | 'part' | 'avg' | 'conv' | 'attendance';

export interface RegColumn {
  key: string;
  name: string;
  kind: RegColumnKind;
  /** raw, part, attendance: the exam's key (attendance without one: every exam of the register) */
  exam?: string;
  /** part: the part's name (Theory, Physics) or its subject code, matched without case */
  part?: string;
  /** part: a subject without parts gives its whole marks here */
  wholeIfNoParts?: boolean;
  /** part columns shown together as one breakup cell, with a Sum / Average at its foot */
  group?: string;
  groupLabel?: string;
  groupFoot?: 'sum' | 'avg' | 'both';
  /** avg: all (the mean), best N, or the sum */
  mode?: 'all' | 'best' | 'sum';
  best?: number;
  /** avg best N: averaged or added */
  agg?: 'avg' | 'sum';
  of?: string[];
  /** conv: the column converted */
  source?: string;
  method?: 'scale' | 'weight';
  /** conv: the new maximum (scale) or the % (weight); 'rest' = what the other counted columns leave of the subject's "total out of" */
  target?: number | 'rest';
  /** attendance: marks by the % reached (the highest slab reached) */
  slabs?: Array<{ minPct: number; marks: number }>;
  /** counts in the subject's total (and so the final) */
  inTotal?: boolean;
  /** worked out, not printed */
  hidden?: boolean;
  /** whole number, an exact .5 kept, before anything made from it */
  round?: boolean;
  /** a grade after the column */
  grade?: boolean;
  /** a conversion prints the source's code (AB) instead of its number */
  showCode?: boolean;
  /** where a pro-rata code takes its marks: 'skip' (none), a column's key, or empty: every other exam column */
  subFrom?: string;
  /** a slot: the exam each member reads (null: not applicable) */
  memberExam?: Record<string, string | null>;
  /** a slot conversion: each member's own target */
  memberTarget?: Record<string, number>;
}

export interface RegSubject {
  key: string;
  /** a subject; or a slot of several (each student has one of them) */
  subjectId?: string;
  slot?: { name: string; members: string[]; breakup?: boolean };
  columns: RegColumn[];
  /** print the subject's Total / % / Grade */
  showTotal?: boolean;
  /** the total scaled to this maximum */
  totalOutOf?: number | null;
  round?: RegRound;
  grade?: boolean;
  pct?: boolean;
  /** "this register" decides optional subjects: counts in the final */
  countInFinal?: boolean;
  /** the parts as columns of their own */
  childInColumns?: boolean;
  /** the subject total's heading */
  totalLabel?: string;
}

export interface RegFinal {
  total: boolean;
  pct: boolean;
  grade: boolean;
  rank: boolean;
  rankBy: 'total' | 'pct';
  round: RegRound;
  result: boolean;
  /** optional subjects: the students' choices (an additional subject stays out) or this register (each subject's switch) */
  optionalMode: 'choices' | 'register';
  /** choices: additional subjects add into the final */
  optionalInFinal: boolean;
  /** a blocking code in a subject that does not count also withholds the final */
  optionalBlocks: boolean;
  passPct: number;
  /** up to this many subjects failed: compartment */
  compartmentUpTo: number;
  /** theory and practical must each reach the pass % (XI-XII) */
  partsEach: boolean;
}

export interface RegDisplay {
  showMax: boolean;
  studentCols: Array<{ key: 'sr' | 'name' | 'roll' | 'adm'; show: boolean }>;
  divisionLabel: boolean;
  properCase: boolean;
  blankNotTaken: boolean;
  childMax: boolean;
  averages: boolean;
  decimals: 'auto' | 1 | 2;
  finalDecimals: 'auto' | 0 | 1 | 2;
  pctDecimals: 'auto' | 0 | 1 | 2;
}

export interface RegAnalysis {
  enabled: boolean;
  bands: Array<{ label: string; op: '>=' | '>'; fromPct: number }>;
  cumulative: Array<{ op: '>=' | '>'; pct: number }>;
}

export interface RegisterDef {
  v: 2;
  layout: 'header' | 'vertical';
  type: 'general' | 'examwise';
  order: 'roll' | 'alpha' | 'rank';
  exams: Array<{ key: string; examId: string }>;
  subjects: RegSubject[];
  /** the subjects in the order above (else the class's order) */
  ownOrder?: boolean;
  /** by exam key */
  codes: Record<string, RegCode[]>;
  final: RegFinal;
  grades: Array<{ grade: string; minPct: number }>;
  divisions: Array<{ name: string; minPct: number }>;
  display: RegDisplay;
  analysis: RegAnalysis;
  /** the grade scale the bands were copied from */
  gradeScaleId?: string | null;
}

// ---- input: a student's marks --------------------------------------------------------------------
export interface RegPart {
  name: string;
  subjectCode?: string | null;
  max: number;
  marks: number | null;
  absent: boolean;
  entered: boolean;
}
export interface RegMark {
  max: number;
  /** null: no entry (or a code) */
  marks: number | null;
  code: string | null;
  entered: boolean;
  parts: RegPart[];
}
export interface RegStudentSubject {
  subjectId: string;
  code: string;
  name: string;
  kind: 'compulsory' | 'optional' | 'additional';
  /** by exam key; missing when the exam does not have the subject */
  marks: Record<string, RegMark | undefined>;
  /** a subject changed mid-year: the exams that carry the old subject's marks */
  note?: string;
}
export interface RegStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  sectionId: string;
  section: string;
  /** days present and days counted, by exam key ('*': all the register's exams together) */
  attendance: Record<string, { present: number; total: number } | undefined>;
  subjects: RegStudentSubject[];
}

// ---- output ---------------------------------------------------------------------------------------
export interface RegCell {
  v: number | null;
  max: number;
  /** the code written in place of marks */
  code?: string;
  /** the value came from a code and is printed with "*" */
  star?: boolean;
  blocked?: boolean;
  /** no marks entered yet */
  missing?: boolean;
  /** out of the marks and the maximum (a code, or the class has no such exam / part) */
  out?: boolean;
  grade?: string | null;
}

export interface RegSubjectResult {
  key: string;
  /** the subject the student has (a slot: their member) */
  subjectId: string;
  code: string;
  name: string;
  kind: 'compulsory' | 'optional' | 'additional';
  /** a slot: the student has two of its members */
  twoMembers?: boolean;
  note?: string;
  values: Record<string, RegCell>;
  /** the columns making the total */
  counted: string[];
  total: number | null;
  max: number;
  pct: number | null;
  grade: string | null;
  status: 'pass' | 'fail' | 'absent' | 'incomplete';
  /** counts in the final */
  inFinal: boolean;
  withheld: boolean;
  missing: boolean;
}

export interface RegStudentResult {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  sectionId: string;
  section: string;
  /** by register subject key; absent = not taken */
  subjects: Record<string, RegSubjectResult | undefined>;
  total: number | null;
  max: number;
  pct: number | null;
  grade: string | null;
  division: string | null;
  result: 'pass' | 'compartment' | 'fail' | 'absent' | 'incomplete';
  failed: string[];
  /** why the final is withheld (subjects with a blocking code) */
  withheldBy: string[];
  rankInSection: number | null;
  rankInClass: number | null;
}

// ---- helpers --------------------------------------------------------------------------------------
export type Rounding = 'none' | 'two' | 'whole' | 'half_kept' | 'up';

export function roundBy(v: number, how: Rounding = 'two'): number {
  switch (how) {
    case 'none':
      return v;
    case 'whole':
      return Math.floor(v + 0.5 + 1e-9);
    case 'up':
      return Math.ceil(v - 1e-9);
    case 'half_kept': {
      // the nearest whole number, an exact .5 kept as it is
      const r = Math.round(v * 100) / 100;
      return Math.abs(r - Math.trunc(r)) === 0.5 ? r : Math.floor(r + 0.5);
    }
    default:
      return Math.round(v * 100) / 100;
  }
}
const two = (v: number) => roundBy(v, 'two');
const byRound = (v: number, r: RegRound | undefined) =>
  r === 'keep' ? roundBy(v, 'half_kept') : r === 'up' ? roundBy(v, 'whole') : two(v);

/** the grade of a %: the first band (highest first) reached, else the lowest band */
export function gradeFor(
  pct: number | null,
  grades: Array<{ grade: string; minPct: number }>,
): string | null {
  if (pct === null || !grades.length) return null;
  const sorted = [...grades].sort((a, b) => b.minPct - a.minPct);
  const p = two(pct);
  return (sorted.find((b) => p >= b.minPct) ?? sorted[sorted.length - 1]!).grade;
}

/** a number with the decimals asked for, cut (not rounded up) as the old register printed it */
export function cutFixed(v: number | null, decimals: 'auto' | 0 | 1 | 2): string {
  if (v === null || !Number.isFinite(v)) return '';
  const r = two(v);
  if (decimals === 'auto') return String(r);
  const f = 10 ** decimals;
  const cut = Math.trunc(r * f + (r >= 0 ? 1e-9 : -1e-9)) / f;
  return cut.toFixed(decimals);
}

/** ABHISHEK VERMA → Abhishek Verma */
export const properCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s.'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** the exam keys a column reads, through the columns it is made from */
export function leafExams(cols: RegColumn[], key: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(key)) return out;
  seen.add(key);
  const c = cols.find((x) => x.key === key);
  if (!c) return out;
  if (c.kind === 'raw' || c.kind === 'part' || c.kind === 'attendance') {
    if (c.exam) out.add(c.exam);
    for (const e of Object.values(c.memberExam ?? {})) if (e) out.add(e);
    return out;
  }
  for (const k of c.kind === 'conv' ? (c.source ? [c.source] : []) : (c.of ?? []))
    for (const e of leafExams(cols, k, seen)) out.add(e);
  return out;
}

const sourcesOf = (c: RegColumn): string[] =>
  c.kind === 'avg' ? (c.of ?? []) : c.kind === 'conv' && c.source ? [c.source] : [];

/**
 * The columns making a subject's total: the ticked ones, less any column another ticked column is made
 * from (so a Best-of and the tests it reads are not both counted); none ticked: every column no other
 * column is made from.
 */
export function countedColumns(cols: RegColumn[]): string[] {
  const ticked = cols.filter((c) => c.inTotal);
  const pool = ticked.length ? ticked : cols;
  const feeds = new Set(pool.flatMap(sourcesOf));
  return pool.filter((c) => !feeds.has(c.key)).map((c) => c.key);
}

const DEFAULT_CODES: RegCode[] = [
  { code: 'AB', meaning: 'Absent', treat: 'zero', blocks: true, showValue: false },
  {
    code: 'ML',
    meaning: 'Medical leave',
    treat: 'prorata',
    blocks: false,
    showValue: false,
    prPct: 100,
  },
  { code: 'L', meaning: 'Leave', treat: 'excl', blocks: false, showValue: false },
  { code: 'EX', meaning: 'Exempted', treat: 'excl', blocks: false, showValue: false },
  { code: 'NA', meaning: 'Not applicable', treat: 'excl', blocks: false, showValue: false },
];

/** the codes a new exam of a register starts with (the legacy's) */
export const defaultCodes = (): RegCode[] => DEFAULT_CODES.map((c) => ({ ...c }));

export const CBSE_8: Array<{ grade: string; minPct: number }> = [
  { grade: 'A1', minPct: 91 },
  { grade: 'A2', minPct: 81 },
  { grade: 'B1', minPct: 71 },
  { grade: 'B2', minPct: 61 },
  { grade: 'C1', minPct: 51 },
  { grade: 'C2', minPct: 41 },
  { grade: 'D', minPct: 33 },
  { grade: 'E', minPct: 0 },
];

export const DEFAULT_SLABS = [
  { minPct: 96, marks: 5 },
  { minPct: 91, marks: 4 },
  { minPct: 86, marks: 3 },
  { minPct: 81, marks: 2 },
  { minPct: 76, marks: 1 },
];

/** a new register's settings (the legacy's defaults) */
export function newRegisterDef(): RegisterDef {
  return {
    v: 2,
    layout: 'header',
    type: 'general',
    order: 'roll',
    exams: [],
    subjects: [],
    codes: {},
    final: {
      total: true,
      pct: true,
      grade: true,
      rank: true,
      rankBy: 'total',
      round: 'up',
      result: true,
      optionalMode: 'choices',
      optionalInFinal: false,
      optionalBlocks: false,
      passPct: 33,
      compartmentUpTo: 2,
      partsEach: false,
    },
    grades: CBSE_8.map((g) => ({ ...g })),
    divisions: [
      { name: '1st Div', minPct: 60 },
      { name: '2nd Div', minPct: 45 },
      { name: 'Pass', minPct: 33 },
    ],
    display: {
      showMax: true,
      studentCols: [
        { key: 'sr', show: true },
        { key: 'name', show: true },
        { key: 'roll', show: false },
        { key: 'adm', show: true },
      ],
      divisionLabel: true,
      properCase: true,
      blankNotTaken: false,
      childMax: false,
      averages: false,
      decimals: 'auto',
      finalDecimals: 'auto',
      pctDecimals: 'auto',
    },
    analysis: {
      enabled: false,
      bands: (
        [
          ['0-32', 0],
          ['33-40', 33],
          ['40-50', 40],
          ['50-60', 50],
          ['60-70', 60],
          ['70-80', 70],
          ['80-90', 80],
          ['90-100', 90],
        ] as const
      ).map(([label, fromPct]) => ({ label, op: '>=' as const, fromPct })),
      cumulative: [50, 60, 70, 80, 90].map((p) => ({ op: '>=' as const, pct: p })),
    },
  };
}

// ---- what is wrong ----------------------------------------------------------------------------------
/** What is wrong with a register, in words (empty: it can be saved and run). */
export function registerProblems(def: RegisterDef): string[] {
  const out: string[] = [];
  const exams = new Set(def.exams.map((e) => e.key));
  if (!def.exams.length) out.push('Choose the exams the register reads');
  if (new Set(def.exams.map((e) => e.key)).size !== def.exams.length)
    out.push('An exam key is there twice');
  if (!def.subjects.length) out.push('Choose the subjects');
  if (!def.grades.length) out.push('Give the grading scale at least one band');
  const subjectKeys = new Set<string>();
  for (const s of def.subjects) {
    const label = s.slot?.name ?? s.key;
    if (subjectKeys.has(s.key)) out.push(`${label}: there twice`);
    subjectKeys.add(s.key);
    if (s.slot && (!s.slot.name.trim() || s.slot.members.length < 2))
      out.push(`${label}: a slot needs a name and two or more subjects`);
    if (!s.slot && !s.subjectId) out.push(`${label}: choose the subject`);
    if (!s.columns.length) out.push(`${label}: add its columns`);
    const keys = new Set<string>();
    for (const c of s.columns) {
      const at = `${label} · ${c.name || c.key}`;
      if (keys.has(c.key)) out.push(`${at}: the same key twice`);
      keys.add(c.key);
      if ((c.kind === 'raw' || c.kind === 'part') && (!c.exam || !exams.has(c.exam)))
        out.push(`${at}: choose one of the register's exams`);
      if (c.kind === 'attendance' && c.exam && !exams.has(c.exam))
        out.push(`${at}: choose one of the register's exams`);
      if (c.kind === 'part' && !c.part?.trim()) out.push(`${at}: choose the part`);
      if (c.kind === 'avg') {
        if (!c.of?.length) out.push(`${at}: choose the columns it is made from`);
        if (c.mode === 'best' && !(c.best && c.best >= 1)) out.push(`${at}: give the best N`);
      }
      if (c.kind === 'conv') {
        if (!c.source) out.push(`${at}: choose the column it converts`);
        if (c.target === undefined || (typeof c.target === 'number' && !(c.target > 0)))
          out.push(`${at}: give the target`);
        if (c.target === 'rest' && !s.totalOutOf)
          out.push(`${at}: "the rest" needs the subject's total out of`);
      }
      if (c.kind === 'attendance' && !c.slabs?.length) out.push(`${at}: set the attendance slabs`);
      for (const k of sourcesOf(c))
        if (!s.columns.some((x) => x.key === k))
          out.push(`${at}: ${k} is not a column of the subject`);
    }
    // loops: a column made, through others, from itself
    const visiting = new Set<string>();
    const done = new Set<string>();
    const walk = (k: string): boolean => {
      if (done.has(k)) return false;
      if (visiting.has(k)) return true;
      visiting.add(k);
      const c = s.columns.find((x) => x.key === k);
      const loop = c ? sourcesOf(c).some(walk) : false;
      visiting.delete(k);
      done.add(k);
      return loop;
    };
    if (s.columns.some((c) => walk(c.key))) out.push(`${label}: a column is made from itself`);
  }
  if (def.divisions.some((d) => !d.name.trim())) out.push('Name every division');
  return out;
}

// ---- working out ----------------------------------------------------------------------------------
interface Ctx {
  def: RegisterDef;
  s: RegStudent;
  sub: RegStudentSubject;
  rs: RegSubject;
  member: string;
}

const lc = (x: string | null | undefined) => (x ?? '').trim().toLowerCase();

function partOf(m: RegMark, name: string | undefined): RegPart | undefined {
  const n = lc(name);
  return m.parts.find((p) => lc(p.name) === n || (p.subjectCode && lc(p.subjectCode) === n));
}

/** the exam a column reads for this student (a slot member may read another, or none) */
function examFor(ctx: Ctx, c: RegColumn): string | null | undefined {
  if (c.memberExam && ctx.member in c.memberExam) return c.memberExam[ctx.member];
  return c.exam;
}

/** the structural maximum of a column (before marks) */
function maxOf(ctx: Ctx, cols: RegColumn[], key: string, seen = new Set<string>()): number {
  if (seen.has(key)) return 0;
  seen.add(key);
  const c = cols.find((x) => x.key === key);
  if (!c) return 0;
  switch (c.kind) {
    case 'raw': {
      const e = examFor(ctx, c);
      return e ? (ctx.sub.marks[e]?.max ?? 0) : 0;
    }
    case 'part': {
      const e = examFor(ctx, c);
      const m = e ? ctx.sub.marks[e] : undefined;
      if (!m) return 0;
      const p = partOf(m, c.part);
      if (p) return p.max;
      return c.wholeIfNoParts && !m.parts.length ? m.max : 0;
    }
    case 'attendance':
      return Math.max(0, ...(c.slabs ?? []).map((x) => x.marks));
    case 'conv': {
      const t = targetOf(ctx, cols, c);
      if (c.method === 'weight') return (maxOf(ctx, cols, c.source ?? '', seen) * t) / 100;
      return t;
    }
    default: {
      const src = (c.of ?? []).map((k) => maxOf(ctx, cols, k, new Set(seen))).filter((x) => x > 0);
      if (!src.length) return 0;
      if (c.mode === 'sum') return src.reduce((a, b) => a + b, 0);
      const mean = src.reduce((a, b) => a + b, 0) / src.length;
      if (c.mode === 'best' && c.agg === 'sum') return mean * Math.min(c.best ?? 1, src.length);
      return mean;
    }
  }
}

function targetOf(ctx: Ctx, cols: RegColumn[], c: RegColumn): number {
  const own = c.memberTarget?.[ctx.member];
  if (typeof own === 'number') return own;
  if (c.target === 'rest') {
    const counted = countedColumns(cols).filter((k) => k !== c.key);
    const rest = (ctx.rs.totalOutOf ?? 0) - counted.reduce((a, k) => a + maxOf(ctx, cols, k), 0);
    return Math.max(0, rest);
  }
  return c.target ?? 0;
}

function codeRule(def: RegisterDef, exam: string, code: string): RegCode {
  const own = def.codes[exam]?.find((x) => lc(x.code) === lc(code));
  if (own) return own;
  // an unknown code leaves the marks and the maximum, without holding anything
  return { code, meaning: code, treat: 'excl', blocks: false, showValue: false };
}

/** one subject of one student: every column, the total, %, grade and status */
function subjectFor(ctx: Ctx): RegSubjectResult {
  const { def, rs, sub } = ctx;
  const cols = rs.columns;
  const values: Record<string, RegCell> = {};
  const busy = new Set<string>();

  const coded = (exam: string, code: string, max: number, col: RegColumn): RegCell => {
    const rule = codeRule(def, exam, code);
    const base = { code: rule.code, blocked: rule.blocks || undefined };
    switch (rule.treat) {
      case 'zero':
        return { ...base, v: 0, max, star: rule.showValue || undefined };
      case 'fixed':
        return {
          ...base,
          v: two(Math.min(rule.amt ?? 0, max)),
          max,
          star: rule.showValue || undefined,
        };
      case 'pctmax':
        return {
          ...base,
          v: two((max * (rule.amt ?? 0)) / 100),
          max,
          star: rule.showValue || undefined,
        };
      case 'prorata': {
        const from = col.subFrom ?? '';
        if (from === 'skip') return { ...base, v: null, max: 0, out: true };
        const srcs =
          from === ''
            ? cols
                .filter((x) => x.key !== col.key && (x.kind === 'raw' || x.kind === 'part'))
                .map((x) => cell(x.key))
            : [cell(from)];
        const live = srcs.filter((x) => x.v !== null && x.max > 0 && !x.out && !x.code);
        const got = live.reduce((a, x) => a + x.v!, 0);
        const of = live.reduce((a, x) => a + x.max, 0);
        if (!(of > 0)) return { ...base, v: null, max: 0, out: true };
        const v = Math.min(max, (got / of) * max * ((rule.prPct ?? 100) / 100));
        return { ...base, v: two(v), max, star: rule.showValue || undefined };
      }
      default:
        return { ...base, v: null, max: 0, out: true };
    }
  };

  const work = (c: RegColumn): RegCell => {
    switch (c.kind) {
      case 'raw': {
        const e = examFor(ctx, c);
        const m = e ? sub.marks[e] : undefined;
        if (!e || !m) return { v: null, max: 0, out: true };
        if (m.code) return coded(e, m.code, m.max, c);
        if (!m.entered || m.marks === null) return { v: null, max: m.max, missing: true };
        return { v: m.marks, max: m.max };
      }
      case 'part': {
        const e = examFor(ctx, c);
        const m = e ? sub.marks[e] : undefined;
        if (!e || !m) return { v: null, max: 0, out: true };
        const p = partOf(m, c.part);
        if (!p) {
          if (c.wholeIfNoParts && !m.parts.length) {
            if (m.code) return coded(e, m.code, m.max, c);
            if (!m.entered || m.marks === null) return { v: null, max: m.max, missing: true };
            return { v: m.marks, max: m.max };
          }
          return { v: null, max: 0, out: true };
        }
        if (p.absent) return coded(e, 'AB', p.max, c);
        if (!p.entered || p.marks === null) return { v: null, max: p.max, missing: true };
        return { v: p.marks, max: p.max };
      }
      case 'attendance': {
        const max = maxOf(ctx, cols, c.key);
        const a = c.exam ? ctx.s.attendance[c.exam] : ctx.s.attendance['*'];
        if (!a || !(a.total > 0)) return { v: null, max, missing: true };
        const pct = Math.round((a.present / a.total) * 100);
        const v =
          [...(c.slabs ?? [])].sort((x, y) => y.minPct - x.minPct).find((x) => pct >= x.minPct)
            ?.marks ?? 0;
        return { v, max };
      }
      case 'conv': {
        const src = cell(c.source ?? '');
        const t = targetOf(ctx, cols, c);
        const max = c.method === 'weight' ? two((src.max * t) / 100) : t;
        const code = c.showCode && src.code ? src.code : undefined;
        if (src.out) return { v: null, max: 0, out: true, code, blocked: src.blocked };
        if (src.v === null || !(src.max > 0))
          return { v: null, max, missing: src.missing, code, blocked: src.blocked };
        const v = c.method === 'weight' ? (src.v * t) / 100 : (src.v / src.max) * t;
        return {
          v: two(v),
          max,
          code,
          blocked: src.blocked,
          star: src.star,
          missing: src.missing,
        };
      }
      default: {
        const srcs = (c.of ?? []).map((k) => cell(k));
        const live = srcs.filter((x) => !x.out);
        if (!live.length) return { v: null, max: 0, out: true };
        const withV = live.filter((x) => x.v !== null);
        const missing = live.some((x) => x.missing);
        if (c.mode === 'sum') {
          const v = withV.reduce((a, x) => a + x.v!, 0);
          const max = live.reduce((a, x) => a + x.max, 0);
          return {
            v: withV.length ? two(v) : null,
            max: two(max),
            missing: missing || undefined,
            blocked: live.some((x) => x.blocked) || undefined,
          };
        }
        if (c.mode === 'best') {
          const n = Math.max(1, Math.min(c.best ?? 1, withV.length || 1));
          const clean = withV.filter((x) => !x.blocked);
          // enough tests without a blocking code: the blocked ones are dropped, not held against
          const pool = clean.length >= n ? clean : withV;
          const taken = [...pool].sort((a, b) => b.v! - a.v!).slice(0, n);
          if (!taken.length) return { v: null, max: two(maxOf(ctx, cols, c.key)), missing: true };
          const sumV = taken.reduce((a, x) => a + x.v!, 0);
          const sumM = taken.reduce((a, x) => a + x.max, 0);
          const sum = c.agg === 'sum';
          return {
            v: two(sum ? sumV : sumV / taken.length),
            max: two(sum ? sumM : sumM / taken.length),
            missing: (missing && withV.length < (c.best ?? 1)) || undefined,
            blocked: taken.some((x) => x.blocked) || undefined,
          };
        }
        if (!withV.length)
          return { v: null, max: two(maxOf(ctx, cols, c.key)), missing: missing || undefined };
        return {
          v: two(withV.reduce((a, x) => a + x.v!, 0) / withV.length),
          max: two(withV.reduce((a, x) => a + x.max, 0) / withV.length),
          missing: missing || undefined,
          blocked: live.some((x) => x.blocked) || undefined,
        };
      }
    }
  };

  function cell(key: string): RegCell {
    const have = values[key];
    if (have) return have;
    const c = cols.find((x) => x.key === key);
    if (!c || busy.has(key)) return { v: null, max: 0, out: true };
    busy.add(key);
    let x = work(c);
    if (c.round && x.v !== null) x = { ...x, v: roundBy(x.v, 'half_kept') };
    busy.delete(key);
    values[key] = x;
    return x;
  }

  for (const c of cols) cell(c.key);
  for (const c of cols)
    if (c.grade) {
      const x = values[c.key]!;
      values[c.key] = {
        ...x,
        grade: x.v === null || !(x.max > 0) ? null : gradeFor((x.v / x.max) * 100, def.grades),
      };
    }

  const counted = countedColumns(cols);
  const parts = counted.map((k) => values[k]!).filter((x) => !x.out);
  const blocked = parts.some((x) => x.blocked);
  const missing = parts.some((x) => x.missing);
  let total: number | null = parts.reduce((a, x) => a + (x.v ?? 0), 0);
  let max = parts.reduce((a, x) => a + x.max, 0);
  if (rs.totalOutOf && max > 0) {
    total = (total * rs.totalOutOf) / max;
    max = rs.totalOutOf;
  }
  total = byRound(total, rs.round);
  max = two(max);
  if (blocked) total = null;
  const pct = total === null || !(max > 0) ? null : two((total / max) * 100);

  let status: RegSubjectResult['status'];
  if (blocked) status = 'absent';
  else if (missing) status = 'incomplete';
  else {
    let ok = pct !== null && pct >= def.final.passPct;
    if (ok && def.final.partsEach)
      for (const want of ['theory', 'practical'] as const) {
        const keys = counted.filter((k) => {
          const c = cols.find((x) => x.key === k)!;
          return c.kind === 'part' && partKind(c.part) === want;
        });
        const got = keys.reduce((a, k) => a + (values[k]!.v ?? 0), 0);
        const of = keys.reduce((a, k) => a + values[k]!.max, 0);
        if (of > 0 && two((got / of) * 100) < def.final.passPct) ok = false;
      }
    status = ok ? 'pass' : 'fail';
  }
  return {
    key: rs.key,
    subjectId: sub.subjectId,
    code: sub.code,
    name: sub.name,
    kind: sub.kind,
    ...(sub.note ? { note: sub.note } : {}),
    values,
    counted,
    total,
    max,
    pct,
    grade: pct === null ? null : gradeFor(pct, def.grades),
    status,
    inFinal: true,
    withheld: blocked,
    missing,
  };
}

const partKind = (name: string | undefined): 'theory' | 'practical' | null => {
  const n = lc(name);
  if (n === 'th' || n.startsWith('theory')) return 'theory';
  if (n === 'pr' || n.startsWith('practical')) return 'practical';
  return null;
};

/** an exam-wise register on one exam: each subject's total is that exam's marks */
export function examView(def: RegisterDef, exam: string): RegisterDef {
  return {
    ...def,
    subjects: def.subjects.map((s) => {
      const leaf = (k: string) => {
        const e = leafExams(s.columns, k);
        return e.size > 0 && [...e].every((x) => x === exam);
      };
      const own = s.columns.find((c) => c.kind === 'raw' && c.exam === exam);
      const columns: RegColumn[] = s.columns.map((c) => ({
        ...c,
        inTotal: own ? c.key === own.key : false,
        hidden: c.hidden || !leaf(c.key),
      }));
      if (!own) columns.push({ key: `__${exam}`, name: exam, kind: 'raw', exam, inTotal: true });
      return { ...s, columns, totalOutOf: null };
    }),
  };
}

/** Competition ranks (1, 1, 3) among the ranked, by a number, highest first. */
function competitionRank<T>(rows: T[], value: (r: T) => number, set: (r: T, n: number) => void) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((r, i) => {
    const v = value(r);
    if (prev === null || Math.abs(v - prev) > 1e-9) rank = i + 1;
    prev = v;
    set(r, rank);
  });
}

/** which member of a slot a student has (the one with marks when two) */
function memberOf(s: RegStudent, rs: RegSubject): { sub: RegStudentSubject; two: boolean } | null {
  if (!rs.slot) {
    const sub = s.subjects.find((x) => x.subjectId === rs.subjectId);
    return sub ? { sub, two: false } : null;
  }
  const mine = s.subjects.filter((x) => rs.slot!.members.includes(x.subjectId));
  if (!mine.length) return null;
  const marked = mine.find((x) => Object.values(x.marks).some((m) => m?.entered));
  return { sub: marked ?? mine[0]!, two: mine.length > 1 };
}

/** A register over some students: every subject's columns and total, the final, result and ranks. */
export function computeRegister(
  def0: RegisterDef,
  students: RegStudent[],
  opts: { exam?: string } = {},
): RegStudentResult[] {
  const def = def0.type === 'examwise' && opts.exam ? examView(def0, opts.exam) : def0;
  const f = def.final;
  const out = students.map((s): RegStudentResult => {
    const subjects: Record<string, RegSubjectResult | undefined> = {};
    for (const rs of def.subjects) {
      const m = memberOf(s, rs);
      if (!m) continue;
      const r = subjectFor({ def, s, sub: m.sub, rs, member: m.sub.subjectId });
      r.inFinal =
        f.optionalMode === 'register'
          ? rs.countInFinal !== false
          : r.kind !== 'additional' || f.optionalInFinal;
      if (m.two) r.twoMembers = true;
      subjects[rs.key] = r;
    }
    const all = Object.values(subjects).filter((x): x is RegSubjectResult => !!x);
    const counted = all.filter((x) => x.inFinal);
    const withheldBy = (f.optionalBlocks ? all : counted)
      .filter((x) => x.withheld)
      .map((x) => x.code);
    const missing = counted.some((x) => x.missing);
    const max = two(counted.reduce((a, x) => a + x.max, 0));
    let total: number | null = byRound(
      counted.reduce((a, x) => a + (x.total ?? 0), 0),
      f.round,
    );
    // withheld (a blocking code) or not complete (a mark not entered): no final yet
    if (withheldBy.length || missing) total = null;
    const pct = total === null || !(max > 0) ? null : two((total / max) * 100);
    const failed = counted.filter((x) => x.status === 'fail').map((x) => x.code);
    const result: RegStudentResult['result'] = withheldBy.length
      ? 'absent'
      : missing
        ? 'incomplete'
        : failed.length === 0
          ? 'pass'
          : failed.length <= f.compartmentUpTo
            ? 'compartment'
            : 'fail';
    const division =
      pct === null || result !== 'pass'
        ? null
        : ([...def.divisions].sort((a, b) => b.minPct - a.minPct).find((d) => pct >= d.minPct)
            ?.name ?? null);
    return {
      studentId: s.studentId,
      name: s.name,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      sectionId: s.sectionId,
      section: s.section,
      subjects,
      total,
      max,
      pct,
      grade: pct === null ? null : gradeFor(pct, def.grades),
      division,
      result,
      failed,
      withheldBy,
      rankInSection: null,
      rankInClass: null,
    };
  });
  const ranked = out.filter((r) => r.result !== 'incomplete' && r.result !== 'absent');
  const by = (r: RegStudentResult) => (f.rankBy === 'pct' ? (r.pct ?? 0) : (r.total ?? 0));
  competitionRank(ranked, by, (r, n) => (r.rankInClass = n));
  for (const sec of new Set(ranked.map((r) => r.sectionId)))
    competitionRank(
      ranked.filter((r) => r.sectionId === sec),
      by,
      (r, n) => (r.rankInSection = n),
    );
  return out;
}

/** students in the register's order: roll, A–Z, or rank (1st Div, 2nd Div …, then the rest) */
export function orderStudents(
  def: RegisterDef,
  rows: RegStudentResult[],
  merit = false,
): RegStudentResult[] {
  const byName = (a: RegStudentResult, b: RegStudentResult) => a.name.localeCompare(b.name);
  if (def.order === 'alpha') return [...rows].sort(byName);
  if (def.order === 'rank' || merit) {
    const rank = (r: RegStudentResult) => (merit ? r.rankInClass : r.rankInSection) ?? Infinity;
    return [...rows].sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  return [...rows].sort(
    (a, b) =>
      a.section.localeCompare(b.section) ||
      (a.rollNo ?? Infinity) - (b.rollNo ?? Infinity) ||
      byName(a, b),
  );
}
