/**
 * Mark schemes (docs/design/65, part 3): the old Dynamic Mark Register as one engine. A scheme reads
 * some exams (by a short key) and builds columns per subject: an exam's marks (or a part of them), an
 * average (of all, or the best N), a sum, a conversion to a maximum, or marks for attendance by slabs;
 * one column is the subject's marks obtained. Marks codes count as each code's treatment says; the
 * result rules give pass / compartment / fail / absent, the grade, the division and a competition rank.
 * Pure functions: the API loads the marks, this works them out (the same for a result scheme and a
 * free register).
 */

import {
  computeRegister,
  newRegisterDef,
  roundBy,
  type CodeTreat,
  type RegCode,
  type RegColumn,
  type RegisterDef,
  type RegRound,
  type RegStudent,
  type RegSubjectResult,
} from './mark-register';

export { roundBy };
export type { Rounding } from './mark-register';
import type { Rounding } from './mark-register';

export type Treatment = 'zero' | 'exclude' | 'fixed' | 'percent' | 'pro_rata';

export interface SchemeColumn {
  key: string;
  label: string;
  kind: 'raw' | 'average' | 'sum' | 'convert' | 'attendance';
  /** raw: the exam's key */
  exam?: string;
  /** raw: one part of the exam subject by its name (Theory, Practical, ...) */
  part?: string;
  /** raw with a part: a subject without parts gives its whole marks here (the Theory column) */
  wholeIfNoParts?: boolean;
  /** average / sum / convert: the source columns */
  of?: string[];
  /** average: the best N only */
  best?: number;
  /** the column's maximum after conversion; 'rest' = what the other parts of the total leave of its target */
  scale?: number | 'rest';
  round?: Rounding;
  /** worked out, not printed */
  hidden?: boolean;
  /** the subject's marks obtained (exactly one column) */
  total?: boolean;
  /** total: the maximum the subject's marks add up to (for 'rest' columns) */
  target?: number;
  /** "theory and practical each": the group this raw column belongs to */
  passGroup?: 'theory' | 'practical';
}

export interface SchemeDef {
  exams: Array<{ key: string; examId: string }>;
  columns: SchemeColumn[];
  /** a scheme's own treatment of a code (else the school's) */
  codes?: Record<string, Treatment>;
  /** attendance %: marks by slab (the highest slab reached) */
  attendance?: Array<{ minPct: number; marks: number }>;
  result: {
    passPct: number;
    /** theory and practical must each reach the pass % (XI-XII) */
    partsEach?: boolean;
    /** up to this many subjects failed: compartment (0: none) */
    compartmentUpTo: number;
    divisions?: Array<{ name: string; minPct: number }>;
    rankBy: 'total' | 'pct';
    /** additional subjects count in the total */
    countAdditional?: boolean;
    totalRound?: Rounding;
  };
  gradeScaleId?: string | null;
}

export interface SchemeCode {
  treatment: Treatment;
  value: number | null;
  blocks: boolean;
}

export interface SchemeMark {
  max: number;
  /** null: no entry (or a code) */
  marks: number | null;
  code: string | null;
  entered: boolean;
  parts: Record<string, { max: number; marks: number | null; absent: boolean; entered: boolean }>;
}

export interface SchemeStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  sectionId: string;
  section: string;
  attendancePct: number | null;
  subjects: Array<{
    subjectId: string;
    code: string;
    name: string;
    kind: 'compulsory' | 'optional' | 'additional';
    /** by exam key; absent when the exam does not have the subject */
    marks: Record<string, SchemeMark | undefined>;
    /** a subject changed mid-year: which exams carry the old subject's marks ("PT1 in Hindi") */
    note?: string;
  }>;
}

export interface SchemeCell {
  v: number | null;
  max: number;
  /** the code written in place of marks */
  code?: string;
}

export interface SchemeSubjectResult {
  subjectId: string;
  code: string;
  name: string;
  kind: 'compulsory' | 'optional' | 'additional';
  values: Record<string, SchemeCell>;
  /** a subject changed mid-year: the exams that carry the old subject's marks */
  note?: string;
  total: number | null;
  max: number;
  pct: number | null;
  grade: string | null;
  status: 'pass' | 'fail' | 'absent' | 'incomplete';
}

export interface SchemeStudentResult {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  sectionId: string;
  section: string;
  subjects: SchemeSubjectResult[];
  total: number | null;
  max: number;
  pct: number | null;
  grade: string | null;
  division: string | null;
  result: 'pass' | 'compartment' | 'fail' | 'absent' | 'incomplete';
  failed: string[];
  rankInSection: number | null;
  rankInClass: number | null;
}

export interface GradeBand {
  grade: string;
  minPct: number;
  maxPct: number;
}

export function gradeOf(pct: number | null, scale: GradeBand[]): string | null {
  if (pct === null) return null;
  const p = Math.round(pct * 100) / 100;
  return scale.find((b) => p >= b.minPct && p <= b.maxPct)?.grade ?? null;
}

/** What is wrong with a scheme, in words (empty: it can be used). */
export function schemeProblems(def: SchemeDef): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  const exams = new Set(def.exams.map((e) => e.key));
  if (!def.columns.length) out.push('Add the columns');
  for (const c of def.columns) {
    if (keys.has(c.key)) out.push(`Column ${c.key} is there twice`);
    if (c.kind === 'raw' && (!c.exam || !exams.has(c.exam)))
      out.push(`Column ${c.key}: choose one of the scheme's exams`);
    if (['average', 'sum', 'convert'].includes(c.kind)) {
      if (!c.of?.length) out.push(`Column ${c.key}: choose the columns it is made from`);
      for (const k of c.of ?? [])
        if (!keys.has(k)) out.push(`Column ${c.key}: ${k} must come before it`);
      if (c.kind === 'convert' && (c.of?.length ?? 0) !== 1)
        out.push(`Column ${c.key}: a conversion takes one column`);
      if (c.kind === 'convert' && c.scale === undefined)
        out.push(`Column ${c.key}: give the maximum to convert to`);
    }
    if (c.kind === 'attendance' && !def.attendance?.length)
      out.push(`Column ${c.key}: set the attendance slabs`);
    if (c.best !== undefined && c.kind !== 'average')
      out.push(`Column ${c.key}: best N is for averages`);
    keys.add(c.key);
  }
  const totals = def.columns.filter((c) => c.total);
  if (totals.length !== 1) out.push('Mark exactly one column as the marks obtained');
  const rest = def.columns.filter((c) => c.scale === 'rest');
  for (const c of rest)
    if (!totals[0] || !totals[0].of?.includes(c.key) || !totals[0].target)
      out.push(
        `Column ${c.key}: "the rest" needs the marks obtained to be a sum with a maximum that includes it`,
      );
  return out;
}

/** a v1 scheme's rounding as a register's (whole numbers .5 up, .5 kept, or as it is) */
const regRound = (r: Rounding | undefined): RegRound =>
  r === 'whole' ? 'up' : r === 'half_kept' ? 'keep' : 'none';

const V1_TREAT: Record<Treatment, CodeTreat> = {
  zero: 'zero',
  exclude: 'excl',
  fixed: 'fixed',
  percent: 'pctmax',
  pro_rata: 'prorata',
};

/**
 * A v1 scheme (one set of columns for every subject) as a register (docs/design/68): every subject
 * gets the same chain; an average or sum with a maximum becomes the average / sum and a conversion; the
 * marks-obtained column becomes the subject's total (its sources counted, its maximum and rounding).
 */
export function fromV1(
  def: SchemeDef,
  subjectIds: string[],
  codes: Record<string, SchemeCode>,
  scale: GradeBand[],
): RegisterDef {
  const tot = def.columns.find((c) => c.total);
  // a sum as the marks obtained gives its sources to the total; any other kind is counted itself
  const totalIsSum = tot?.kind === 'sum';
  const counted = new Set(totalIsSum ? (tot.of ?? []) : tot ? [tot.key] : []);
  const columns: RegColumn[] = [];
  for (const c of def.columns) {
    if (c === tot && totalIsSum) continue;
    const base = {
      key: c.key,
      name: c.label,
      hidden: c.hidden,
      inTotal: counted.has(c.key),
      round: c !== tot && (c.round === 'whole' || c.round === 'half_kept') ? true : undefined,
    };
    if (c.kind === 'raw')
      columns.push(
        c.part
          ? { ...base, kind: 'part', exam: c.exam, part: c.part, wholeIfNoParts: c.wholeIfNoParts }
          : { ...base, kind: 'raw', exam: c.exam },
      );
    else if (c.kind === 'attendance')
      columns.push({ ...base, kind: 'attendance', slabs: def.attendance ?? [] });
    else if (c.kind === 'convert')
      columns.push({ ...base, kind: 'conv', source: c.of?.[0], method: 'scale', target: c.scale });
    else {
      const mode = c.kind === 'sum' ? 'sum' : c.best ? 'best' : 'all';
      const avg: RegColumn = { ...base, kind: 'avg', mode, best: c.best, agg: 'avg', of: c.of };
      if (c.scale === undefined) columns.push(avg);
      else {
        const inner = `${c.key}~`;
        columns.push({
          ...avg,
          key: inner,
          name: `${c.label} (made of)`,
          hidden: true,
          inTotal: false,
          round: undefined,
        });
        columns.push({ ...base, kind: 'conv', source: inner, method: 'scale', target: c.scale });
      }
    }
  }
  const reg = newRegisterDef();
  const own = (code: string): RegCode => {
    const school = codes[code];
    const t = def.codes?.[code] ?? school?.treatment ?? (code === 'AB' ? 'zero' : 'exclude');
    const value = school?.value ?? null;
    return {
      code,
      meaning: code,
      treat: V1_TREAT[t],
      amt: value,
      blocks: school ? school.blocks : code === 'AB',
      showValue: false,
      prPct: 100,
    };
  };
  const list = [...new Set(['AB', ...Object.keys(codes), ...Object.keys(def.codes ?? {})])];
  return {
    ...reg,
    exams: def.exams,
    subjects: subjectIds.map((id) => ({
      key: id,
      subjectId: id,
      columns: columns.map((c) => ({ ...c })),
      showTotal: true,
      totalOutOf: totalIsSum ? (tot.target ?? null) : null,
      round: regRound(tot?.round),
      grade: true,
      pct: true,
      totalLabel: tot?.label,
    })),
    codes: Object.fromEntries(def.exams.map((e) => [e.key, list.map(own)])),
    final: {
      ...reg.final,
      rankBy: def.result.rankBy,
      round: regRound(def.result.totalRound ?? 'two'),
      optionalMode: 'choices',
      optionalInFinal: Boolean(def.result.countAdditional),
      passPct: def.result.passPct,
      compartmentUpTo: def.result.compartmentUpTo,
      partsEach: Boolean(def.result.partsEach),
    },
    grades: scale.map((b) => ({ grade: b.grade, minPct: b.minPct })),
    divisions: def.result.divisions ?? [],
    gradeScaleId: def.gradeScaleId ?? null,
  };
}

/** a v1 student (one attendance %) as a register's */
const toRegStudent = (s: SchemeStudent): RegStudent => ({
  ...s,
  attendance: s.attendancePct === null ? {} : { '*': { present: s.attendancePct, total: 100 } },
  subjects: s.subjects.map((x) => ({
    ...x,
    marks: Object.fromEntries(
      Object.entries(x.marks).map(([k, m]) => [
        k,
        m && {
          ...m,
          parts: Object.entries(m.parts).map(([name, p]) => ({ name, ...p })),
        },
      ]),
    ),
  })),
});

/** A scheme over a class: every student's subjects, totals, result, division and ranks (the register engine). */
export function computeScheme(
  def: SchemeDef,
  students: SchemeStudent[],
  codes: Record<string, SchemeCode>,
  scale: GradeBand[],
): SchemeStudentResult[] {
  const ids = [...new Set(students.flatMap((s) => s.subjects.map((x) => x.subjectId)))];
  const reg = fromV1(def, ids, codes, scale);
  const tot = def.columns.find((c) => c.total);
  return computeRegister(reg, students.map(toRegStudent)).map((r) => ({
    ...r,
    subjects: reg.subjects
      .map((rs) => r.subjects[rs.key])
      .filter((x): x is RegSubjectResult => !!x)
      .map((x) => ({
        subjectId: x.subjectId,
        code: x.code,
        name: x.name,
        kind: x.kind,
        values: {
          ...Object.fromEntries(
            Object.entries(x.values)
              .filter(([k]) => !k.endsWith('~'))
              .map(([k, c]) => [k, { v: c.v, max: c.max, ...(c.code ? { code: c.code } : {}) }]),
          ),
          ...(tot ? { [tot.key]: { v: x.total, max: x.max } } : {}),
        },
        ...(x.note ? { note: x.note } : {}),
        total: x.total,
        max: x.max,
        pct: x.pct,
        grade: x.grade,
        status: x.status,
      })),
  }));
}

/** Ready-made schemes from the old DPS Noida cards: the exams are named by key, mapped when used. */
export const SCHEME_PRESETS: Array<{
  code: string;
  name: string;
  description: string;
  def: Omit<SchemeDef, 'exams'> & { examKeys: Array<{ key: string; label: string }> };
}> = [
  {
    code: 'DPS_VI_VIII',
    name: 'Classes VI-VIII (one term)',
    description:
      'Periodic test 15 (the average of MT1 and MT2 converted) + subject enrichment 5 (the average of SE1 and SE2) + the term exam 80 = 100, whole numbers (half up).',
    def: {
      examKeys: [
        { key: 'MT1', label: 'Monday test 1' },
        { key: 'MT2', label: 'Monday test 2' },
        { key: 'SE1', label: 'Subject enrichment 1' },
        { key: 'SE2', label: 'Subject enrichment 2' },
        { key: 'TERM', label: 'Half-yearly / yearly exam' },
      ],
      columns: [
        { key: 'MT1', label: 'MT1', kind: 'raw', exam: 'MT1', hidden: true },
        { key: 'MT2', label: 'MT2', kind: 'raw', exam: 'MT2', hidden: true },
        { key: 'PT', label: 'Periodic test (15)', kind: 'average', of: ['MT1', 'MT2'], scale: 15 },
        { key: 'SE1', label: 'SE1', kind: 'raw', exam: 'SE1', hidden: true },
        { key: 'SE2', label: 'SE2', kind: 'raw', exam: 'SE2', hidden: true },
        {
          key: 'SE',
          label: 'Subject enrichment (5)',
          kind: 'average',
          of: ['SE1', 'SE2'],
          scale: 5,
        },
        { key: 'TERM', label: 'Term exam (80)', kind: 'raw', exam: 'TERM' },
        {
          key: 'TOT',
          label: 'Marks obtained (100)',
          kind: 'sum',
          of: ['PT', 'SE', 'TERM'],
          total: true,
          round: 'whole',
        },
      ],
      result: {
        passPct: 33,
        compartmentUpTo: 2,
        divisions: [
          { name: 'First', minPct: 60 },
          { name: 'Second', minPct: 45 },
          { name: 'Pass', minPct: 33 },
        ],
        rankBy: 'total',
        totalRound: 'whole',
      },
    },
  },
  {
    code: 'DPS_IX',
    name: 'Class IX (term 1)',
    description:
      'Monday tests 15 (average converted) + subject enrichment 5 + the term exam 80 (theory and practical) = 100; additional subjects (AI, IFM) out of the total.',
    def: {
      examKeys: [
        { key: 'MT1', label: 'Monday test 1' },
        { key: 'MT2', label: 'Monday test 2' },
        { key: 'SE1', label: 'Subject enrichment 1' },
        { key: 'TERM', label: 'Term 1 exam' },
      ],
      columns: [
        { key: 'MT1', label: 'MT1', kind: 'raw', exam: 'MT1', hidden: true },
        { key: 'MT2', label: 'MT2', kind: 'raw', exam: 'MT2', hidden: true },
        { key: 'MT', label: 'Monday tests (15)', kind: 'average', of: ['MT1', 'MT2'], scale: 15 },
        { key: 'SE1', label: 'SE1', kind: 'raw', exam: 'SE1', hidden: true },
        { key: 'SE', label: 'Subject enrichment (5)', kind: 'convert', of: ['SE1'], scale: 5 },
        { key: 'TERM', label: 'Term 1 (80)', kind: 'raw', exam: 'TERM' },
        {
          key: 'TOT',
          label: 'Marks obtained (100)',
          kind: 'sum',
          of: ['MT', 'SE', 'TERM'],
          total: true,
          round: 'whole',
        },
      ],
      result: { passPct: 33, compartmentUpTo: 2, rankBy: 'total', totalRound: 'whole' },
    },
  },
  {
    code: 'DPS_X',
    name: 'Class X (pre-term / mid-term)',
    description:
      'The Monday tests (average) converted to what the theory leaves of 100, + the theory paper (50, 70 or 80) = 100; the sixth subject out of the total.',
    def: {
      examKeys: [
        { key: 'MT1', label: 'Monday test 1' },
        { key: 'MT2', label: 'Monday test 2' },
        { key: 'TERM', label: 'Pre-term / mid-term exam' },
      ],
      columns: [
        { key: 'MT1', label: 'MT1', kind: 'raw', exam: 'MT1', hidden: true },
        { key: 'MT2', label: 'MT2', kind: 'raw', exam: 'MT2', hidden: true },
        { key: 'MT', label: 'Monday tests', kind: 'average', of: ['MT1', 'MT2'], scale: 'rest' },
        { key: 'TH', label: 'Theory', kind: 'raw', exam: 'TERM' },
        {
          key: 'TOT',
          label: 'Total (100)',
          kind: 'sum',
          of: ['MT', 'TH'],
          total: true,
          target: 100,
          round: 'whole',
        },
      ],
      result: { passPct: 33, compartmentUpTo: 2, rankBy: 'total', totalRound: 'whole' },
    },
  },
  {
    code: 'DPS_XI',
    name: 'Class XI (term 1)',
    description:
      'Weekly tests (average) converted to what the rest leaves of 100 + ASL 10 + the term exam (theory and practical); theory and practical 33 % each; the additional subject printed last and out of the total.',
    def: {
      examKeys: [
        { key: 'WT1', label: 'Weekly test 1' },
        { key: 'WT2', label: 'Weekly test 2' },
        { key: 'ASL', label: 'ASL' },
        { key: 'TERM', label: 'Term 1 exam' },
      ],
      columns: [
        { key: 'WT1', label: 'WT1', kind: 'raw', exam: 'WT1', hidden: true },
        { key: 'WT2', label: 'WT2', kind: 'raw', exam: 'WT2', hidden: true },
        { key: 'WT', label: 'Weekly tests', kind: 'average', of: ['WT1', 'WT2'], scale: 'rest' },
        { key: 'ASLR', label: 'ASL', kind: 'raw', exam: 'ASL', hidden: true },
        { key: 'ASL', label: 'ASL (10)', kind: 'convert', of: ['ASLR'], scale: 10 },
        {
          key: 'TH',
          label: 'Theory',
          kind: 'raw',
          exam: 'TERM',
          part: 'Theory',
          wholeIfNoParts: true,
          passGroup: 'theory',
        },
        {
          key: 'PR',
          label: 'Practical',
          kind: 'raw',
          exam: 'TERM',
          part: 'Practical',
          passGroup: 'practical',
        },
        {
          key: 'TOT',
          label: 'Total (100)',
          kind: 'sum',
          of: ['WT', 'ASL', 'TH', 'PR'],
          total: true,
          target: 100,
          round: 'whole',
        },
      ],
      result: {
        passPct: 33,
        partsEach: true,
        compartmentUpTo: 1,
        rankBy: 'total',
        totalRound: 'whole',
      },
    },
  },
  {
    code: 'DPS_XII',
    name: 'Class XII (pre-term / mid-term)',
    description:
      'Monday test 2 (converted to what the theory leaves of 100) + the theory paper = 100, whole numbers; all six subjects count.',
    def: {
      examKeys: [
        { key: 'MT2', label: 'Monday test 2' },
        { key: 'TERM', label: 'Pre-term / mid-term exam' },
      ],
      columns: [
        { key: 'MT2', label: 'MT2', kind: 'raw', exam: 'MT2', hidden: true },
        { key: 'MT', label: 'Monday test', kind: 'convert', of: ['MT2'], scale: 'rest' },
        { key: 'TH', label: 'Theory', kind: 'raw', exam: 'TERM' },
        {
          key: 'TOT',
          label: 'Total (100)',
          kind: 'sum',
          of: ['MT', 'TH'],
          total: true,
          target: 100,
          round: 'whole',
        },
      ],
      result: {
        passPct: 33,
        compartmentUpTo: 2,
        rankBy: 'total',
        countAdditional: true,
        totalRound: 'whole',
      },
    },
  },
];

/** a stored definition is a register (docs/design/68) or a v1 scheme */
export const isRegisterDef = (def: SchemeDef | RegisterDef): def is RegisterDef =>
  (def as RegisterDef).v === 2;

/**
 * The columns a term result prints (the report card): a v1 scheme's printed columns; a register's
 * printed columns in the order they first come, then its total ("_total" in the stored values).
 */
export function printedColumns(
  def: SchemeDef | RegisterDef,
): Array<{ key: string; label: string; total: boolean }> {
  if (!isRegisterDef(def))
    return def.columns
      .filter((x) => !x.hidden)
      .map((x) => ({ key: x.key, label: x.label, total: Boolean(x.total) }));
  const out: Array<{ key: string; label: string; total: boolean }> = [];
  for (const s of def.subjects)
    for (const c of s.columns)
      if (!c.hidden && !out.some((x) => x.key === c.key))
        out.push({ key: c.key, label: c.name, total: false });
  out.push({ key: '_total', label: def.subjects[0]?.totalLabel ?? 'Total', total: true });
  return out;
}
