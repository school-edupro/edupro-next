import {
  bestFive,
  round2,
  type AnCandidate,
  type AnSubject,
  type BoardRules,
} from './board-analysis';

/**
 * The Results tab (docs/design/88): one row a candidate, as the school's old "Student Marks Data" screen — every
 * subject with its marks and grade, the compartment subjects, the result, the aggregate by the chosen method (the
 * school's best five, or all subjects), the percentage and the rank. Ranks are dense (equal totals share a rank,
 * the next one follows: 1, 2, 3, 3, 3, 4) and are the class's, whatever the filters.
 */
/** best5: the school's best five; first5: the first five as CBSE printed them; all: every subject with marks */
export type MarksMethod = 'best5' | 'first5' | 'all';
export type MarksBand = '90' | '75' | '60' | '45' | 'below45';
export type MarksSort = 'rank' | 'roll' | 'name' | 'section';

export interface MarksRow {
  roll: string;
  name: string | null;
  sex: string | null;
  section: string | null;
  studentId: string | null;
  admissionNo: string | null;
  result: string | null;
  compartment: Array<{ code: string; name: string }>;
  subjects: Array<{
    code: string;
    name: string;
    /** the name as CBSE abbreviates it on its sheets ("English Lng & Lit", "Maths Std") for the wide table */
    short: string;
    marks: number | null;
    grade: string | null;
    /** in the aggregate (the best five, or every subject) */
    counted: boolean;
  }>;
  max: number | null;
  total: number | null;
  percent: number | null;
  rank: number | null;
}

export interface MarksFilter {
  section?: string | undefined;
  result?: string | undefined;
  band?: MarksBand | undefined;
  sort: MarksSort;
  q?: string | undefined;
}

/** Every candidate of a class and year with the method's aggregate and the class rank. */
export function marksRows(
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
  method: MarksMethod,
): MarksRow[] {
  const kind = (code: string) => subjects.find((s) => s.code === code)?.kind;
  const nameOf = (code: string) => subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
  const rows: MarksRow[] = candidates.map((c) => {
    const shown = c.marks.filter((m) => kind(m.code) !== 'internal');
    const marked = shown.filter((m): m is typeof m & { marks: number } => m.marks !== null);
    let total: number | null = null;
    let max: number | null = null;
    let percent: number | null = null;
    let counted = new Set<string>();
    if (marked.length) {
      if (method === 'best5') {
        const b = bestFive(c, kind, rules, nameOf);
        total = b.total;
        max = 500;
        percent = b.percent;
        counted = new Set(b.codes);
      } else if (method === 'first5') {
        // the first five subjects in the order CBSE printed them
        const first = marked.slice(0, 5);
        total = first.reduce((a, m) => a + m.marks, 0);
        max = 500;
        percent = round2(total / 5);
        counted = new Set(first.map((m) => m.code));
      } else {
        total = marked.reduce((a, m) => a + m.marks, 0);
        max = marked.length * 100;
        percent = round2((total * 100) / max);
        counted = new Set(marked.map((m) => m.code));
      }
    }
    return {
      roll: c.roll,
      name: c.name,
      sex: c.sex,
      section: c.section,
      studentId: c.studentId ?? null,
      admissionNo: c.admissionNo ?? null,
      result: c.result,
      compartment: c.compartment.map((code) => ({ code, name: nameOf(code) })),
      subjects: shown.map((m) => ({
        code: m.code,
        name: nameOf(m.code),
        short: shortSubject(nameOf(m.code)),
        marks: m.marks,
        grade: m.grade,
        counted: counted.has(m.code),
      })),
      max,
      total,
      percent,
      rank: null,
    };
  });
  // dense ranks by the percentage (the same as the total for the best five), over the class
  const scored = rows.filter((r) => r.percent !== null).sort((a, b) => b.percent! - a.percent!);
  let rank = 0;
  let last: number | null = null;
  for (const r of scored) {
    if (r.percent !== last) {
      rank += 1;
      last = r.percent;
    }
    r.rank = rank;
  }
  return rows;
}

/** A subject name shortened as CBSE's own sheets do, for a table of many subjects. */
export function shortSubject(name: string): string {
  return name
    .replace(/Language and Literature/i, 'Lng & Lit')
    .replace(/\band\b/gi, '&')
    .replace(/Mathematics/i, 'Maths')
    .replace(/\(Standard\)/i, 'Std')
    .replace(/\(Basic\)/i, 'Basic')
    .replace(/Social Science/i, 'Social Sc')
    .replace(/Computer Applications?/i, 'Comp App')
    .replace(/Information Technology/i, 'IT')
    .replace(/Artificial Intelligence/i, 'AI')
    .replace(/Physical Education/i, 'Phy Edu')
    .replace(/Hindustani Music/i, 'Music')
    .replace(/Instruments/i, 'Inst')
    .replace(/\s+/g, ' ')
    .trim();
}

const inBand = (p: number | null, band: MarksBand) => {
  if (p === null) return false;
  if (band === '90') return p >= 90;
  if (band === '75') return p >= 75 && p < 90;
  if (band === '60') return p >= 60 && p < 75;
  if (band === '45') return p >= 45 && p < 60;
  return p < 45;
};

/** The rows the filters keep, in the chosen order (absent candidates last when by rank). */
export function filterMarks(rows: MarksRow[], f: MarksFilter): MarksRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const out = rows.filter(
    (r) =>
      (!f.section || r.section === f.section) &&
      (!f.result || r.result === f.result) &&
      (!f.band || inBand(r.percent, f.band)) &&
      (!q || r.roll.startsWith(q) || (r.name ?? '').toLowerCase().includes(q)),
  );
  const byRoll = (a: MarksRow, b: MarksRow) => a.roll.localeCompare(b.roll);
  const sorts: Record<MarksSort, (a: MarksRow, b: MarksRow) => number> = {
    rank: (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byRoll(a, b),
    roll: byRoll,
    name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '') || byRoll(a, b),
    section: (a, b) =>
      (a.section ?? '~').localeCompare(b.section ?? '~', 'en', { numeric: true }) ||
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      byRoll(a, b),
  };
  return out.sort(sorts[f.sort]);
}
