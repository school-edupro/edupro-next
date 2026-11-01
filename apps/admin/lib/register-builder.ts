import type { RegColumn, RegisterDef, RegMark, RegStudent, RegSubject } from '@edupro/ui';
import type { BuilderData } from './mark-schemes';

/**
 * The register builder's helpers (docs/design/68), pure: the exam keys a register reads, a subject's
 * exams and parts, Copy to subjects, the Weightage builder, and the preview's two sample students.
 */
type Paper = BuilderData['subjects'][number]['papers'][number];

/** a register subject's own subjects (a slot: its members) */
export const membersOf = (s: RegSubject): string[] =>
  s.slot ? s.slot.members : s.subjectId ? [s.subjectId] : [];

/** the papers (an exam for a class) of a register subject's subjects */
export function papersOf(data: BuilderData | null, s: RegSubject): Paper[] {
  if (!data) return [];
  const ids = membersOf(s);
  return data.subjects.filter((x) => ids.includes(x.id)).flatMap((x) => x.papers);
}

/** the exams a subject has, each with its maximum (or the lowest–highest across classes) */
export function examsOfSubject(
  data: BuilderData | null,
  s: RegSubject,
): Array<{ examId: string; code: string; name: string; max: string }> {
  if (!data) return [];
  const papers = papersOf(data, s);
  return data.exams
    .filter((e) => papers.some((p) => p.examId === e.id))
    .map((e) => {
      const maxes = [...new Set(papers.filter((p) => p.examId === e.id).map((p) => p.max))];
      const lo = Math.min(...maxes);
      const hi = Math.max(...maxes);
      return {
        examId: e.id,
        code: e.code,
        name: e.name,
        max: lo === hi ? String(lo) : `${String(lo)}–${String(hi)}`,
      };
    });
}

/** the parts a subject has in an exam (the union across its classes; each class runs with its own) */
export function partsOf(data: BuilderData | null, s: RegSubject, examId: string): string[] {
  const out: string[] = [];
  for (const p of papersOf(data, s).filter((x) => x.examId === examId))
    for (const part of p.parts) if (!out.includes(part.name)) out.push(part.name);
  return out;
}

/** a register's key for an exam: its code in capitals (made unique) */
export function examKey(def: RegisterDef, examId: string, code: string): string {
  const have = def.exams.find((e) => e.examId === examId);
  if (have) return have.key;
  const base = (code.toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'EXAM').replace(/^[^A-Z]/, 'E');
  let key = base.slice(0, 12);
  let n = 2;
  while (def.exams.some((e) => e.key === key)) key = `${base.slice(0, 10)}${String(n++)}`;
  return key;
}

/** the register with the exam added (and its codes from the school's), when it is not there yet */
export function withExam(
  def: RegisterDef,
  data: BuilderData | null,
  examId: string,
): { def: RegisterDef; key: string } {
  const e = data?.exams.find((x) => x.id === examId);
  const key = examKey(def, examId, e?.code ?? 'EXAM');
  if (def.exams.some((x) => x.key === key)) return { def, key };
  return {
    key,
    def: {
      ...def,
      exams: [...def.exams, { key, examId }],
      codes: { ...def.codes, [key]: (data?.codes ?? []).map((c) => ({ ...c })) },
    },
  };
}

/** a new key for a column of a subject */
export function columnKey(cols: RegColumn[], base: string): string {
  const b = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'C';
  let key = b;
  let n = 2;
  while (cols.some((c) => c.key === key)) key = `${b}${String(n++)}`;
  return key;
}


/** a column out, and anything made from it out of its sources (a conversion of it goes too) */
export function dropColumn(cols: RegColumn[], key: string): RegColumn[] {
  const left = cols
    .filter((c) => c.key !== key)
    .map((c) =>
      c.kind === 'avg' && c.of?.includes(key) ? { ...c, of: c.of.filter((k) => k !== key) } : c,
    );
  const dead = left.filter((c) => c.kind === 'conv' && c.source === key).map((c) => c.key);
  return dead.reduce(dropColumn, left);
}

/**
 * Copy to subjects: the source's chain into each target. Each target keeps its own maximum (read when
 * it runs); a column on an exam the target does not have is left out, with what is made from it; a
 * part is matched by name, else the chain reads the target's parts or its whole marks.
 */
export function copyColumns(
  data: BuilderData | null,
  from: RegSubject,
  to: RegSubject,
  def: RegisterDef,
): { columns: RegColumn[]; skipped: string[] } {
  const examIdOf = (key: string | undefined) => def.exams.find((e) => e.key === key)?.examId;
  const has = new Set(papersOf(data, to).map((p) => p.examId));
  let columns: RegColumn[] = from.columns.map((c) => ({
    ...c,
    memberExam: undefined,
    memberTarget: undefined,
  }));
  const skipped: string[] = [];
  for (const c of [...columns]) {
    if (!(c.kind === 'raw' || c.kind === 'part')) continue;
    const examId = examIdOf(c.exam);
    if (!examId || !has.has(examId)) {
      skipped.push(c.name);
      columns = dropColumn(columns, c.key);
      continue;
    }
    if (c.kind === 'part') {
      const parts = partsOf(data, to, examId);
      if (!parts.some((p) => p.toLowerCase() === (c.part ?? '').toLowerCase())) {
        // a plain subject: the part's column reads the whole marks once, the others drop out
        const group = columns.filter((x) => x.group && x.group === c.group);
        if (!parts.length && group[0]?.key === c.key)
          columns = columns.map((x) =>
            x.key === c.key
              ? { ...x, kind: 'raw', part: undefined, group: undefined, name: c.exam ?? x.name }
              : x,
          );
        else {
          skipped.push(c.name);
          columns = dropColumn(columns, c.key);
        }
      }
    }
  }
  return { columns, skipped };
}

/** the Weightage builder: raw parts count as they are, weighted ones are converted and added */
export function weightageColumns(
  rows: Array<{
    examKey: string;
    part: string | null;
    label: string;
    use: 'raw' | 'weighted' | 'skip';
    target: number;
  }>,
): RegColumn[] {
  const cols: RegColumn[] = [];
  const weighted: string[] = [];
  for (const r of rows) {
    if (r.use === 'skip') continue;
    const base: RegColumn = r.part
      ? { key: '', name: r.label, kind: 'part', exam: r.examKey, part: r.part }
      : { key: '', name: r.label, kind: 'raw', exam: r.examKey };
    if (r.use === 'raw') {
      cols.push({ ...base, key: columnKey(cols, r.label), inTotal: true, subFrom: 'skip' });
      continue;
    }
    const raw = { ...base, key: columnKey(cols, `${r.label}R`), hidden: true, subFrom: 'skip' };
    cols.push(raw);
    const conv: RegColumn = {
      key: columnKey(cols, `${r.label}W`),
      name: `${r.label} (${String(r.target)})`,
      kind: 'conv',
      source: raw.key,
      method: 'scale',
      target: r.target,
      hidden: true,
    };
    cols.push(conv);
    weighted.push(conv.key);
  }
  if (weighted.length)
    cols.push({
      key: columnKey(cols, 'WT'),
      name: 'Weighted total',
      kind: 'avg',
      mode: 'sum',
      of: weighted,
      inTotal: true,
    });
  return cols;
}

/** what a column does, in words */
export function describe(c: RegColumn, cols: RegColumn[]): string {
  const name = (k: string) => cols.find((x) => x.key === k)?.name ?? k;
  switch (c.kind) {
    case 'raw':
      return `${c.exam ?? ''} marks as entered`;
    case 'part':
      return `${c.exam ?? ''}: ${c.part ?? ''}`;
    case 'attendance':
      return `attendance of ${c.exam ?? 'every exam'}: ${(c.slabs ?? []).map((x) => `≥${String(x.minPct)}% → ${String(x.marks)}`).join(', ')}`;
    case 'conv':
      return c.method === 'weight'
        ? `${name(c.source ?? '')} × ${String(c.target)} %`
        : `${name(c.source ?? '')} scaled to ${c.target === 'rest' ? 'what the rest leave of the total' : String(c.target)}`;
    default: {
      const of = (c.of ?? []).map(name).join(', ');
      return c.mode === 'sum'
        ? `sum of ${of}`
        : c.mode === 'best'
          ? `best ${String(c.best ?? 1)} of ${of} (${c.agg === 'sum' ? 'added' : 'averaged'})`
          : `average of ${of}`;
    }
  }
}

/** the preview's sample students: one at about 80 %, one at about 55 %, the marks given over them */
export function sampleStudents(
  def: RegisterDef,
  data: BuilderData | null,
  given: Record<string, string>,
): RegStudent[] {
  const out: RegStudent[] = [];
  for (const [i, share] of [0.8, 0.55].entries()) {
    const subjects: RegStudent['subjects'] = [];
    for (const s of def.subjects) {
      const ids = membersOf(s);
      const id = ids[Math.min(i, ids.length - 1)];
      const info = data?.subjects.find((x) => x.id === id);
      if (!id || !info) continue;
      const marks: Record<string, RegMark> = {};
      for (const e of def.exams) {
        const p = info.papers.find((x) => x.examId === e.examId);
        if (!p) continue;
        const raw = given[`${String(i)}|${s.key}|${e.key}`];
        const code = raw && /^[A-Za-z]/.test(raw.trim()) ? raw.trim().toUpperCase() : null;
        const n = raw !== undefined && raw.trim() !== '' && !code ? Number(raw) : null;
        const v = code
          ? null
          : n !== null && Number.isFinite(n)
            ? n
            : Math.round(p.max * share * 2) / 2;
        marks[e.key] = {
          max: p.max,
          marks: v,
          code,
          entered: raw === undefined || raw.trim() !== '',
          parts: p.parts.map((x) => ({
            name: x.name,
            subjectCode: x.code,
            max: x.max,
            marks: v === null ? null : Math.round((v * x.max * 2) / p.max) / 2,
            absent: code === 'AB',
            entered: raw === undefined || raw.trim() !== '',
          })),
        };
      }
      subjects.push({
        subjectId: id,
        code: info.code,
        name: info.name,
        kind: 'compulsory',
        marks,
      });
    }
    out.push({
      studentId: `sample-${String(i + 1)}`,
      name: `Sample student ${String(i + 1)}`,
      admissionNo: `S${String(i + 1)}`,
      rollNo: i + 1,
      sectionId: 'sample',
      section: 'Sample',
      attendance: Object.fromEntries([
        ...def.exams.map((e) => [e.key, { present: i ? 160 : 190, total: 200 }]),
        ['*', { present: i ? 160 : 190, total: 200 }],
      ]),
      subjects,
    });
  }
  return out;
}
