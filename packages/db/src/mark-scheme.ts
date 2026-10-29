/**
 * Mark schemes (docs/design/65, part 3): the old Dynamic Mark Register as one engine. A scheme reads
 * some exams (by a short key) and builds columns per subject: an exam's marks (or a part of them), an
 * average (of all, or the best N), a sum, a conversion to a maximum, or marks for attendance by slabs;
 * one column is the subject's marks obtained. Marks codes count as each code's treatment says; the
 * result rules give pass / compartment / fail / absent, the grade, the division and a competition rank.
 * Pure functions: the API loads the marks, this works them out (the same for a result scheme and a
 * free register).
 */

export type Rounding = 'none' | 'two' | 'whole' | 'half_kept' | 'up';
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

const pctOf = (c: SchemeCell) => (c.v === null || !(c.max > 0) ? null : (c.v / c.max) * 100);

/** One subject of one student. */
function subjectResult(
  def: SchemeDef,
  s: SchemeStudent,
  sub: SchemeStudent['subjects'][number],
  codes: Record<string, SchemeCode>,
  scale: GradeBand[],
): SchemeSubjectResult & { blocked: boolean; missing: boolean } {
  const values: Record<string, SchemeCell> = {};
  const excluded = new Set<string>();
  let blocked = false;
  let missing = false;
  const treat = (code: string): SchemeCode =>
    def.codes?.[code]
      ? { ...(codes[code] ?? { value: null, blocks: false }), treatment: def.codes[code]! }
      : (codes[code] ?? {
          treatment: code === 'AB' ? 'zero' : 'exclude',
          value: null,
          blocks: code === 'AB',
        });
  const proRata: string[] = [];
  // the structural maximum of a column (before marks), for "the rest" of a total
  const maxOf = (c: SchemeColumn): number => {
    if (c.kind === 'raw') {
      const m = sub.marks[c.exam!];
      if (!m) return 0;
      if (c.part) {
        const p = m.parts[c.part];
        if (p) return p.max;
        return c.wholeIfNoParts && Object.keys(m.parts).length === 0 ? m.max : 0;
      }
      return m.max;
    }
    if (c.kind === 'attendance') return Math.max(0, ...(def.attendance ?? []).map((x) => x.marks));
    if (typeof c.scale === 'number') return c.scale;
    if (c.scale === 'rest') {
      const tot = def.columns.find((x) => x.total)!;
      const others = (tot.of ?? []).filter((k) => k !== c.key);
      return Math.max(
        0,
        (tot.target ?? 0) -
          others.reduce((a, k) => a + maxOf(def.columns.find((x) => x.key === k)!), 0),
      );
    }
    const src = (c.of ?? []).map((k) => maxOf(def.columns.find((x) => x.key === k)!));
    if (c.kind === 'sum') return src.reduce((a, b) => a + b, 0);
    if (c.kind === 'average') {
      const live = src.filter((x) => x > 0);
      return live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0;
    }
    return src[0] ?? 0;
  };

  // the exams' marks first, then pro-rata codes from them, then the columns made from them
  const raws = def.columns.filter((c) => c.kind === 'raw');
  const made = def.columns.filter((c) => c.kind !== 'raw');
  for (const c of raws) {
    const max = maxOf(c);
    const m = sub.marks[c.exam!];
    if (!m || max === 0) {
      values[c.key] = { v: null, max: 0 };
      excluded.add(c.key);
      continue;
    }
    const part = c.part ? m.parts[c.part] : undefined;
    if (c.part && part) {
      if (!part.entered) missing = true;
      if (part.absent) {
        const t = treat('AB');
        if (t.blocks) blocked = true;
        values[c.key] = { v: t.treatment === 'zero' ? 0 : null, max, code: 'AB' };
        if (t.treatment !== 'zero') excluded.add(c.key);
      } else values[c.key] = { v: part.marks, max };
      continue;
    }
    if (!m.entered) {
      missing = true;
      values[c.key] = { v: null, max };
      continue;
    }
    if (m.code) {
      const t = treat(m.code);
      if (t.blocks) blocked = true;
      const v =
        t.treatment === 'zero'
          ? 0
          : t.treatment === 'fixed'
            ? Math.min(t.value ?? 0, max)
            : t.treatment === 'percent'
              ? (max * (t.value ?? 0)) / 100
              : null;
      values[c.key] = { v, max, code: m.code };
      if (v === null) {
        if (t.treatment === 'pro_rata') proRata.push(c.key);
        else excluded.add(c.key);
      }
      continue;
    }
    values[c.key] = { v: m.marks, max };
  }
  // pro-rata codes: the share the subject's other exams give
  for (const k of proRata) {
    const others = raws
      .filter((x) => x.key !== k && !proRata.includes(x.key) && !excluded.has(x.key))
      .map((x) => pctOf(values[x.key]!))
      .filter((p): p is number => p !== null);
    if (others.length) {
      const p = others.reduce((a, b) => a + b, 0) / others.length;
      values[k] = { ...values[k]!, v: roundBy((values[k]!.max * p) / 100) };
    } else excluded.add(k);
  }
  for (const c of made) {
    const max = maxOf(c);
    const srcs = (c.of ?? [])
      .filter((k) => !excluded.has(k))
      .map((k) => values[k])
      .filter((x): x is SchemeCell => !!x && x.v !== null && x.max > 0);
    let v: number | null = null;
    let cmax = max;
    if (c.kind === 'attendance') {
      const pct = s.attendancePct;
      v =
        pct === null
          ? null
          : ([...(def.attendance ?? [])]
              .sort((a, b) => b.minPct - a.minPct)
              .find((x) => pct >= x.minPct)?.marks ?? 0);
    } else if (!srcs.length) {
      v = null;
      // nothing to average or add (codes left them out): out of the maximum too
      if ((c.of ?? []).every((k) => excluded.has(k))) excluded.add(c.key);
    } else if (c.kind === 'average') {
      const taken =
        c.best && c.best < srcs.length
          ? [...srcs].sort((a, b) => (pctOf(b) ?? 0) - (pctOf(a) ?? 0)).slice(0, c.best)
          : srcs;
      if (c.scale !== undefined) {
        const p = taken.reduce((a, x) => a + (pctOf(x) ?? 0), 0) / taken.length;
        v = (p * max) / 100;
      } else {
        v = taken.reduce((a, x) => a + x.v!, 0) / taken.length;
        cmax = taken.reduce((a, x) => a + x.max, 0) / taken.length;
      }
    } else if (c.kind === 'sum') {
      const got = srcs.reduce((a, x) => a + x.v!, 0);
      const of = srcs.reduce((a, x) => a + x.max, 0);
      if (c.scale !== undefined) v = of > 0 ? (got / of) * max : null;
      else {
        v = got;
        // a source left out by a code leaves the maximum too
        cmax = (c.of ?? [])
          .filter((k) => !excluded.has(k))
          .reduce((a, k) => a + (values[k]?.max ?? 0), 0);
      }
    } else {
      const x = srcs[0]!;
      v = (x.v! / x.max) * max;
    }
    values[c.key] = { v: v === null ? null : roundBy(v, c.round), max: roundBy(cmax) };
  }

  const totalCol = def.columns.find((c) => c.total)!;
  const tot = values[totalCol.key]!;
  const total = tot.v;
  const pct = total === null || !(tot.max > 0) ? null : (total / tot.max) * 100;
  let status: SchemeSubjectResult['status'];
  if (missing) status = 'incomplete';
  else if (blocked) status = 'absent';
  else {
    const ok = pct !== null && roundBy(pct) >= def.result.passPct;
    let groupsOk = true;
    if (def.result.partsEach)
      for (const g of ['theory', 'practical'] as const) {
        const cols = def.columns.filter((c) => c.passGroup === g && values[c.key]?.max);
        if (!cols.length) continue;
        const got = cols.reduce((a, c) => a + (values[c.key]!.v ?? 0), 0);
        const of = cols.reduce((a, c) => a + values[c.key]!.max, 0);
        if (of > 0 && roundBy((got / of) * 100) < def.result.passPct) groupsOk = false;
      }
    status = ok && groupsOk ? 'pass' : 'fail';
  }
  return {
    subjectId: sub.subjectId,
    code: sub.code,
    name: sub.name,
    kind: sub.kind,
    values,
    total,
    max: tot.max,
    pct: pct === null ? null : roundBy(pct),
    grade: gradeOf(pct, scale),
    status,
    blocked,
    missing,
  };
}

/** Competition ranks (1, 2, 2, 4) among the ranked, by a number, highest first. */
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

/** A scheme over a class: every student's subjects, totals, result, division and ranks. */
export function computeScheme(
  def: SchemeDef,
  students: SchemeStudent[],
  codes: Record<string, SchemeCode>,
  scale: GradeBand[],
): SchemeStudentResult[] {
  const out = students.map((s) => {
    const subjects = s.subjects.map((sub) => subjectResult(def, s, sub, codes, scale));
    const counted = subjects.filter((x) => x.kind !== 'additional' || def.result.countAdditional);
    const missing = counted.some((x) => x.missing);
    const absent = counted.some((x) => x.blocked);
    const sumTotal = counted.reduce((a, x) => a + (x.total ?? 0), 0);
    const max = counted.reduce((a, x) => a + x.max, 0);
    const total = missing ? null : roundBy(sumTotal, def.result.totalRound ?? 'two');
    const pct = total === null || !(max > 0) ? null : roundBy((total / max) * 100);
    const failed = counted.filter((x) => x.status === 'fail').map((x) => x.code);
    const result: SchemeStudentResult['result'] = missing
      ? 'incomplete'
      : absent
        ? 'absent'
        : failed.length === 0
          ? 'pass'
          : failed.length <= def.result.compartmentUpTo
            ? 'compartment'
            : 'fail';
    const division =
      pct === null || result !== 'pass'
        ? null
        : ([...(def.result.divisions ?? [])]
            .sort((a, b) => b.minPct - a.minPct)
            .find((d) => pct >= d.minPct)?.name ?? null);
    return {
      studentId: s.studentId,
      name: s.name,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      sectionId: s.sectionId,
      section: s.section,
      subjects: subjects.map(({ blocked: _b, missing: _m, ...x }) => x),
      total,
      max: roundBy(max),
      pct,
      grade: gradeOf(pct, scale),
      division,
      result,
      failed,
      rankInSection: null as number | null,
      rankInClass: null as number | null,
    };
  });
  const ranked = out.filter((r) => r.result !== 'incomplete' && r.result !== 'absent');
  const by = (r: SchemeStudentResult) =>
    def.result.rankBy === 'pct' ? (r.pct ?? 0) : (r.total ?? 0);
  competitionRank(ranked, by, (r, n) => (r.rankInClass = n));
  for (const sec of new Set(ranked.map((r) => r.sectionId)))
    competitionRank(
      ranked.filter((r) => r.sectionId === sec),
      by,
      (r, n) => (r.rankInSection = n),
    );
  return out;
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
