import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * The CBSE result "gazette" (docs/design/88, phase A): a fixed-width printout, a page header repeated on every
 * page, then a few lines per candidate (roll no, flag, sex, name, the subject codes, the marks and grades under
 * them, internal grades, result, compartment subjects). Its layout differs between Class X and XII and can change
 * from year to year, so a layout is data: a field is a line of the record, a start column (0-based) and a width.
 * Everything here is pure — the service stores and the AI learner proposes layouts; these functions read and check.
 */

export type BoardClass = 'X' | 'XII';

/** Where a field sits: `line` of the candidate's record (0 = its first line), 0-based `start`, `width` (0 = absent). */
export interface FieldAt {
  line: number;
  start: number;
  width: number;
}

export interface GazetteLayout {
  /** A regular expression the first line of every candidate's record matches. */
  recordStart: string;
  linesPerRecord: number;
  roll: FieldAt;
  flag: FieldAt;
  sex: FieldAt;
  name: FieldAt;
  subjects: Array<{ code: FieldAt; marks: FieldAt; grade: FieldAt }>;
  internalGrades: FieldAt[];
  result: FieldAt;
  compartment: FieldAt;
  /** What the marks show for an absent candidate (e.g. AB). */
  absentMarks: string[];
}

export interface GazetteSubject {
  slot: number;
  code: string;
  marks: number | null;
  absent: boolean;
  grade: string;
}

export interface GazetteCandidate {
  /** The record's first line in the file (1-based). */
  line: number;
  roll: string;
  flag: string;
  sex: string;
  name: string;
  subjects: GazetteSubject[];
  internalGrades: string[];
  result: string;
  compartment: string[];
}

export interface GazetteProblem {
  line: number;
  roll: string;
  field: string;
  message: string;
  /** error: the record cannot be trusted; warning: kept as printed. */
  level: 'error' | 'warning';
}

/** Result words CBSE prints, and what each means (an unknown word is kept as printed, with a warning). */
export const RESULT_WORDS: Record<string, string> = {
  PASS: 'Passed',
  COMP: 'Compartment',
  FAIL: 'Failed',
  ER: 'Essential repeat',
  ABST: 'Absent',
  RW: 'Result withheld',
  RL: 'Result later',
  UFM: 'Unfair means case',
  XXXX: 'Not declared',
};

const GRADE = /^(A[12]|B[12]|C[12]|D[12]?|E[12]?)$/;
const INTERNAL_GRADE = /^[A-E][12]?$/;
const field = (rec: string[], f: FieldAt) =>
  f.width > 0 ? (rec[f.line] ?? '').substring(f.start, f.start + f.width).trim() : '';

/** The examination title (dates, region, page and years taken out) and the column headings, spaces collapsed. */
export function headingOf(text: string): { title: string; headings: string[] } {
  const lines = text.split(/\r?\n/);
  const dashes = lines.reduce<number[]>(
    (a, l, i) => (/^\s*-{20,}\s*$/.test(l) ? [...a, i] : a),
    [],
  );
  const titleLine = lines.find((l) => /EXAMINATION/i.test(l)) ?? '';
  const title = titleLine
    .replace(/DATE\s*:-?\s*[\d/-]+/i, '')
    .replace(/REGION\s*:.*?(?=PAGE|$)/i, '')
    .replace(/PAGE\s*:-?\s*\d+/i, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const headings =
    dashes.length >= 2
      ? lines
          .slice(dashes[0]! + 1, dashes[1])
          .map((l) => l.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      : [];
  return { title, headings };
}

/** The layout's fingerprint: same title words and same column headings = the same layout. */
export function fingerprintOf(text: string): string {
  const h = headingOf(text);
  return createHash('sha256')
    .update(`${h.title}|${h.headings.join('|')}`)
    .digest('hex')
    .slice(0, 32);
}

/** Reads every candidate with a layout and checks each field. */
export function readGazette(
  text: string,
  layout: GazetteLayout,
): { candidates: GazetteCandidate[]; problems: GazetteProblem[] } {
  const lines = text.split(/\r?\n/);
  let start: RegExp;
  try {
    start = new RegExp(layout.recordStart);
  } catch {
    return {
      candidates: [],
      problems: [
        {
          line: 0,
          roll: '',
          field: 'layout',
          message: 'The record start is not valid',
          level: 'error',
        },
      ],
    };
  }
  const absent = new Set(layout.absentMarks.map((x) => x.toUpperCase()));
  const candidates: GazetteCandidate[] = [];
  const problems: GazetteProblem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    if (!start.test(lines[i]!)) continue;
    const rec = lines.slice(i, i + layout.linesPerRecord);
    const line = i + 1;
    i += layout.linesPerRecord - 1;
    const roll = field(rec, layout.roll);
    const p = (f: string, message: string, level: 'error' | 'warning' = 'error') =>
      problems.push({ line, roll, field: f, message, level });
    if (!/^\d{6,10}$/.test(roll)) p('roll', 'The roll number is not a number');
    else if (seen.has(roll)) p('roll', 'The roll number appears twice');
    seen.add(roll);
    const sex = field(rec, layout.sex).toUpperCase();
    if (!/^[MFT]$/.test(sex)) p('sex', `Sex "${sex}" is not M, F or T`, 'warning');
    const name = field(rec, layout.name).replace(/\s+/g, ' ');
    if (!name) p('name', 'No name');
    const subjects: GazetteSubject[] = [];
    layout.subjects.forEach((s, slot) => {
      const code = field(rec, s.code);
      if (!code) return;
      // CBSE prints every code with 3 digits (085): a cut-off code means the layout does not fit
      if (!/^\d{3}$/.test(code)) {
        p(`subject ${String(slot + 1)}`, `Subject code "${code}" is not a 3-digit code`);
        return;
      }
      const raw = field(rec, s.marks).toUpperCase();
      const grade = field(rec, s.grade).toUpperCase();
      const isAbsent = absent.has(raw);
      // nothing printed under the code (an absent or unfair-means candidate's blank line): kept, no marks
      const blank = raw === '' && grade === '';
      const marks = isAbsent || blank ? null : /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!isAbsent && !blank && (Number.isNaN(marks) || (marks ?? 0) > 100))
        p(`subject ${code}`, `Marks "${raw}" are not 0–100 or absent`);
      if (grade && !GRADE.test(grade)) p(`subject ${code}`, `Grade "${grade}" is not a CBSE grade`);
      if (!grade && !isAbsent && !blank) p(`subject ${code}`, 'No grade', 'warning');
      subjects.push({
        slot: slot + 1,
        code,
        marks: Number.isNaN(marks) ? null : marks,
        absent: isAbsent,
        grade,
      });
    });
    if (!subjects.length) p('subjects', 'No subject found');
    const internalGrades = layout.internalGrades.map((f) => field(rec, f).toUpperCase());
    internalGrades.forEach((g, k) => {
      if (g && !INTERNAL_GRADE.test(g))
        p(`internal ${String(k + 1)}`, `Internal grade "${g}" is not a grade`, 'warning');
    });
    const result = field(rec, layout.result).toUpperCase().replace(/\s+/g, ' ');
    if (!result) p('result', 'No result');
    else if (!RESULT_WORDS[result.split(' ')[0]!])
      p('result', `Result "${result}" is not a known word; kept as printed`, 'warning');
    const compartment = (field(rec, layout.compartment).match(/\d{2,3}/g) ?? []).map((c) =>
      c.padStart(3, '0'),
    );
    candidates.push({
      line,
      roll,
      flag: field(rec, layout.flag).toUpperCase(),
      sex,
      name,
      subjects,
      internalGrades,
      result,
      compartment,
    });
  }
  return { candidates, problems };
}

/** A layout fits the file when it finds candidates and no more than 5 % (at least 1) of them have an error. */
export function layoutFits(read: { candidates: GazetteCandidate[]; problems: GazetteProblem[] }) {
  const bad = new Set(read.problems.filter((p) => p.level === 'error').map((p) => p.line));
  const total = read.candidates.length;
  return {
    ok: total > 0 && bad.size <= Math.max(1, Math.floor(total * 0.05)),
    total,
    bad: bad.size,
  };
}

// ---- built-in layouts (the 2026 files) -----------------------------------------------------------------------

const at = (line: number, start: number, width: number): FieldAt => ({ line, start, width });

export interface KnownLayout {
  key: string;
  name: string;
  classLabel: BoardClass;
  /** The heading text the fingerprint is made from. */
  title: string;
  headings: string[];
  layout: GazetteLayout;
}

export const BUILT_IN_LAYOUTS: KnownLayout[] = [
  {
    key: 'builtin:cbse-x-2026',
    name: 'CBSE Class X gazette (2026)',
    classLabel: 'X',
    title: 'C.B.S.E. - ALL INDIA SECONDARY SCHOOL EXAMINATION -',
    headings: [
      'ROLL F S NAME OF CANDIDATE -----------------SUBJECTS----------------------- RESULT COMP',
      'NO L X SUB CD SUB CD SUB CD SUB CD SUB CD SUB CD SUB CD SUB',
      'MKS GR MKS GR MKS GR MKS GR MKS GR MKS GR MKS GR',
    ],
    layout: {
      recordStart: '^\\d{8} ',
      linesPerRecord: 2,
      roll: at(0, 0, 8),
      flag: at(0, 9, 1),
      sex: at(0, 11, 1),
      name: at(0, 13, 51),
      subjects: [0, 1, 2, 3, 4, 5, 6].map((k) => ({
        code: at(0, 64 + 7 * k, 3),
        marks: at(1, 64 + 7 * k, 3),
        grade: at(1, 68 + 7 * k, 2),
      })),
      internalGrades: [],
      result: at(0, 114, 18),
      compartment: at(0, 132, 24),
      absentMarks: ['AB'],
    },
  },
  {
    key: 'builtin:cbse-xii-2026',
    name: 'CBSE Class XII gazette (2026)',
    classLabel: 'XII',
    title: 'C.B.S.E. - SENIOR SCHOOL CERTIFICATE EXAMINATION (MAIN)-',
    headings: [
      'ROLL F S NAME OF CANDIDATE --------------------SUBJECTS------------------ INT-SB-GRD RES COMP',
      'NO L X SUB CD SUB CD SUB CD SUB CD SUB CD SUB CD GR1 GR2 GR3 SUB',
      'MKS GR MKS GR MKS GR MKS GR MKS GR MKS GR',
    ],
    layout: {
      recordStart: '^\\d{8} ',
      linesPerRecord: 2,
      roll: at(0, 0, 8),
      flag: at(0, 9, 1),
      sex: at(0, 11, 1),
      name: at(0, 13, 52),
      subjects: [0, 1, 2, 3, 4, 5].map((k) => ({
        code: at(0, 65 + 8 * k, 3),
        marks: at(1, 65 + 8 * k, 3),
        grade: at(1, 70 + 8 * k, 2),
      })),
      internalGrades: [at(0, 114, 2), at(0, 117, 2), at(0, 120, 2)],
      result: at(0, 126, 18),
      compartment: at(0, 144, 30),
      absentMarks: ['AB'],
    },
  },
];

export const builtInFingerprint = (k: KnownLayout) =>
  createHash('sha256')
    .update(`${k.title.replace(/\s+/g, ' ').trim()}|${k.headings.join('|')}`)
    .digest('hex')
    .slice(0, 32);

// ---- the layout an AI proposes: schema (sent with the request) and validation (of the reply) --------------------

const fieldSchema = (description: string) => ({
  type: 'object',
  description,
  additionalProperties: false,
  required: ['line', 'start', 'width'],
  properties: {
    line: { type: 'integer', description: "Line of the candidate's record, 0 = its first line" },
    start: { type: 'integer', description: '0-based column where the field starts' },
    width: { type: 'integer', description: 'Number of columns; 0 when the file has no such field' },
  },
});

/** JSON schema of the reply (structured output): every object closed, every property required. */
export const LAYOUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordStart',
    'linesPerRecord',
    'roll',
    'flag',
    'sex',
    'name',
    'subjects',
    'internalGrades',
    'result',
    'compartment',
    'absentMarks',
    'notes',
  ],
  properties: {
    recordStart: {
      type: 'string',
      description:
        "A JavaScript regular expression that the FIRST line of every candidate's record matches and no other line does",
    },
    linesPerRecord: { type: 'integer', description: 'Lines each candidate takes' },
    roll: fieldSchema('Roll number'),
    flag: fieldSchema('The one-letter flag column (FL), width 0 if none'),
    sex: fieldSchema('Sex (M / F)'),
    name: fieldSchema('Name of candidate (the whole width up to the first subject column)'),
    subjects: {
      type: 'array',
      description: 'One entry per subject slot, left to right',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'marks', 'grade'],
        properties: {
          code: fieldSchema('Subject code'),
          marks: fieldSchema('Marks of that subject (or AB)'),
          grade: fieldSchema('Grade of that subject'),
        },
      },
    },
    internalGrades: {
      type: 'array',
      description: 'Internal-subject grades (e.g. GR1 GR2 GR3), empty if none',
      items: fieldSchema('One internal grade'),
    },
    result: fieldSchema('Result word (PASS, COMP …)'),
    compartment: fieldSchema('Compartment subject code(s), width 0 if none'),
    absentMarks: {
      type: 'array',
      items: { type: 'string' },
      description: 'What the marks show for an absent candidate',
    },
    notes: { type: 'string', description: 'Anything unusual about this layout, in one sentence' },
  },
};

const FieldZ = z.object({
  line: z.number().int().min(0).max(5),
  start: z.number().int().min(0).max(400),
  width: z.number().int().min(0).max(80),
});
/** The reply validated again on our side (a schema-valid reply can still be nonsense). */
export const LayoutZ = z.object({
  recordStart: z.string().min(1).max(200),
  linesPerRecord: z.number().int().min(1).max(6),
  roll: FieldZ,
  flag: FieldZ,
  sex: FieldZ,
  name: FieldZ,
  subjects: z
    .array(z.object({ code: FieldZ, marks: FieldZ, grade: FieldZ }))
    .min(1)
    .max(12),
  internalGrades: z.array(FieldZ).max(6),
  result: FieldZ,
  compartment: FieldZ,
  absentMarks: z.array(z.string().trim().min(1).max(6)).max(6),
  notes: z.string().max(500).optional(),
});

/** Every field's line must fall inside the record. */
export function layoutProblems(l: GazetteLayout): string[] {
  const out: string[] = [];
  const fields: Array<[string, FieldAt]> = [
    ['roll', l.roll],
    ['flag', l.flag],
    ['sex', l.sex],
    ['name', l.name],
    ['result', l.result],
    ['compartment', l.compartment],
    ...l.subjects.flatMap((s, k): Array<[string, FieldAt]> => [
      [`subject ${String(k + 1)} code`, s.code],
      [`subject ${String(k + 1)} marks`, s.marks],
      [`subject ${String(k + 1)} grade`, s.grade],
    ]),
    ...l.internalGrades.map((f, k): [string, FieldAt] => [`internal ${String(k + 1)}`, f]),
  ];
  for (const [n, f] of fields)
    if (f.width > 0 && f.line >= l.linesPerRecord)
      out.push(`${n} is on line ${String(f.line)} of a ${String(l.linesPerRecord)}-line record`);
  if (l.roll.width === 0) out.push('No roll number field');
  if (l.result.width === 0) out.push('No result field');
  return out;
}

// ---- what the AI may see: headings and sample records with every name and number masked -----------------------

const KEEP = new Set([...Object.keys(RESULT_WORDS), 'AB', 'SCHOOL', 'ROLL', 'NO']);

/**
 * One line masked, token by token, positions kept: a grade (A1, B2 …) or a result word stays; otherwise digits →
 * 9 and every run of 2+ letters → X (single letters — the flag, M / F — stay).
 */
function maskLine(line: string): { text: string; masked: number } {
  let masked = 0;
  const text = line.replace(/\S+/g, (tok) => {
    const up = tok.toUpperCase();
    if (KEEP.has(up) || GRADE.test(up) || INTERNAL_GRADE.test(up)) return tok;
    return tok.replace(/\d/g, '9').replace(/[A-Za-z]{2,}/g, (w) => {
      masked += 1;
      return 'X'.repeat(w.length);
    });
  });
  return { text, masked };
}

/** A column ruler (tens over units) so the reader can count columns exactly. */
export function ruler(width: number): string {
  let tens = '';
  let units = '';
  for (let i = 0; i < width; i += 1) {
    tens += i % 10 === 0 ? String(Math.floor(i / 10) % 10) : ' ';
    units += String(i % 10);
  }
  return `${tens}\n${units}`;
}

/**
 * The part of the file the AI may see: the heading block (the school's line masked) and a few candidate records
 * (the first, one with the most subjects, one with an absent mark, one whose result is not PASS) — names, roll
 * numbers and marks masked, every column in place. Returns the text and how many words were masked.
 */
export function maskedSample(
  text: string,
  records = 4,
): { text: string; masked: number; width: number } {
  const lines = text.split(/\r?\n/);
  const firstRecord = lines.findIndex((l) => /^\s*\d{6,10}\s/.test(l));
  const head = (firstRecord > 0 ? lines.slice(0, firstRecord) : lines.slice(0, 15)).filter(
    (l) => l.trim() !== '',
  );
  const starts = lines.reduce<number[]>(
    (a, l, i) => (/^\s*\d{6,10}\s/.test(l) ? [...a, i] : a),
    [],
  );
  const recLen = starts.length > 1 ? Math.max(1, Math.min(4, starts[1]! - starts[0]!)) : 2;
  const pick = new Set<number>();
  if (starts[0] !== undefined) pick.add(starts[0]);
  const tokens = (i: number) => (lines[i] ?? '').trim().split(/\s+/).length;
  const most = [...starts].sort((a, b) => tokens(b) - tokens(a))[0];
  if (most !== undefined) pick.add(most);
  const absent = starts.find((i) => /\bAB\b/.test(lines.slice(i, i + recLen).join(' ')));
  if (absent !== undefined) pick.add(absent);
  const notPass =
    starts.find((i) => /\bCOMP\b/.test(lines[i] ?? '')) ??
    starts.find((i) => !/\bPASS\b/.test(lines[i] ?? ''));
  if (notPass !== undefined) pick.add(notPass);
  for (const i of starts) {
    if (pick.size >= records) break;
    pick.add(i);
  }
  let masked = 0;
  const out: string[] = [];
  for (const l of head) {
    if (/SCHOOL\s*:/i.test(l)) {
      out.push(l.replace(/(SCHOOL\s*:\s*-?\s*).*/i, (_m, p: string) => `${p}99999 XXXXXX`));
      masked += 1;
      continue;
    }
    // the headings are the point (column titles, not people): only the date is masked
    out.push(
      l
        .replace(/(DATE\s*:-?\s*)[\d/-]+/i, (_x, p: string) => `${p}99-99-9999`)
        .replace(/(REGION\s*:\s*)(\S+)/i, (_x, p: string, r: string) => p + 'X'.repeat(r.length)),
    );
  }
  out.push('');
  for (const i of [...pick].sort((a, b) => a - b).slice(0, records))
    for (const l of lines.slice(i, i + recLen)) {
      const m = maskLine(l);
      masked += m.masked;
      out.push(m.text);
    }
  const width = Math.max(...out.map((l) => l.length), 80);
  return { text: out.join('\n'), masked, width };
}
