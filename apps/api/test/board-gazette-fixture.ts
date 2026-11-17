/**
 * Made-up CBSE result gazettes (docs/design/88) in the shapes of the 2026 Class X and XII files, and a "new"
 * layout (columns moved, headings reworded) that no known layout reads. Names, roll numbers and marks are invented.
 */
export interface FixtureCandidate {
  roll: string;
  flag?: string;
  sex: 'M' | 'F';
  name: string;
  /** [code, marks ('' = nothing printed, 'AB' = absent), grade] */
  subjects: Array<[string, string, string]>;
  internal?: [string, string, string];
  result: string;
  compartment?: string[];
}

function line(parts: Array<[number, string]>): string {
  const a: string[] = [];
  for (const [start, text] of parts)
    for (let i = 0; i < text.length; i += 1) a[start + i] = text[i]!;
  return Array.from(a, (ch) => ch ?? ' ')
    .join('')
    .replace(/\s+$/, '');
}
const marks = (m: string) => (m === 'AB' ? ' AB' : m === '' ? '' : m.padStart(3, '0'));

const DASHES = '-'.repeat(150);

function head(title: string, headings: string[]): string[] {
  return [
    '',
    '',
    `DATE:- 18-07-2026    ${title}      REGION: SAMPLE-REGION         PAGE:-       1`,
    '                                     ***** (SCHOOL / ROLL NO WISE GAZETTE) *****',
    '',
    DASHES,
    ...headings,
    DASHES,
    '',
    'SCHOOL : - 99001   SAMPLE PUBLIC SCHOOL NEW TOWN',
    '',
  ];
}

/** Class X, 2026 shape: 7 subject slots 7 wide from column 64, grade 4 to the right, result at 114, compartment at 132. */
export function gazetteX(candidates: FixtureCandidate[], year = 2026): string {
  const out = head(`C.B.S.E. - ALL INDIA SECONDARY SCHOOL EXAMINATION -${String(year)}`, [
    'ROLL    F S NAME OF CANDIDATE                                   -----------------SUBJECTS-----------------------  RESULT            COMP',
    'NO      L X                                                     SUB CD SUB CD SUB CD SUB CD SUB CD SUB CD SUB CD                    SUB',
    '                                                                MKS GR MKS GR MKS GR MKS GR MKS GR MKS GR MKS GR',
  ]);
  for (const c of candidates) {
    out.push(
      line([
        [0, c.roll],
        [9, c.flag ?? ' '],
        [11, c.sex],
        [13, c.name],
        ...c.subjects.map(([code], k): [number, string] => [64 + 7 * k, code]),
        [114, c.result],
        [132, (c.compartment ?? []).join(' ')],
      ]),
      line(
        c.subjects.flatMap(([, m, g], k): Array<[number, string]> => [
          [64 + 7 * k, marks(m)],
          [68 + 7 * k, g],
        ]),
      ),
    );
  }
  return out.join('\r\n');
}

/** Class XII, 2026 shape: 6 slots 8 wide from column 65, grade 5 to the right, internal grades 114/117/120, result 126. */
export function gazetteXII(candidates: FixtureCandidate[], year = 2026): string {
  const out = head(`C.B.S.E. - SENIOR SCHOOL CERTIFICATE EXAMINATION (MAIN)-${String(year)}`, [
    'ROLL    F S NAME OF CANDIDATE                                   --------------------SUBJECTS------------------  INT-SB-GRD   RES                COMP',
    'NO      L X                                                     SUB CD  SUB CD  SUB CD  SUB CD  SUB CD  SUB CD  GR1 GR2 GR3                     SUB',
    '                                                                MKS GR  MKS GR  MKS GR  MKS GR  MKS GR  MKS GR ',
  ]);
  for (const c of candidates) {
    out.push(
      line([
        [0, c.roll],
        [9, c.flag ?? ' '],
        [11, c.sex],
        [13, c.name],
        ...c.subjects.map(([code], k): [number, string] => [65 + 8 * k, code]),
        [114, c.internal?.[0] ?? ''],
        [117, c.internal?.[1] ?? ''],
        [120, c.internal?.[2] ?? ''],
        [126, c.result],
        [144, (c.compartment ?? []).join(' ')],
      ]),
      line(
        c.subjects.flatMap(([, m, g], k): Array<[number, string]> => [
          [65 + 8 * k, marks(m)],
          [70 + 8 * k, g],
        ]),
      ),
    );
  }
  return out.join('\r\n');
}

/**
 * A "new" Class X layout no known layout reads: the headings reworded, the name from column 15, 6 slots 9 wide
 * from column 70 with the grade 5 to the right, the result at 126.
 */
export function gazetteNewX(candidates: FixtureCandidate[]): string {
  const out = head('C.B.S.E. - SECONDARY SCHOOL EXAMINATION (CLASS X) -2027', [
    'ROLL NO   FL SX CANDIDATE NAME                                        ---------------SUBJECT CODE / MARKS / GRADE---------------  RESULT       COMP',
    '                                                                      CODE     CODE     CODE     CODE     CODE     CODE                       SUBJ',
    '                                                                      MRK GRD  MRK GRD  MRK GRD  MRK GRD  MRK GRD  MRK GRD',
  ]);
  for (const c of candidates) {
    out.push(
      line([
        [0, c.roll],
        [10, c.flag ?? ' '],
        [13, c.sex],
        [15, c.name],
        ...c.subjects.map(([code], k): [number, string] => [70 + 9 * k, code]),
        [126, c.result],
        [139, (c.compartment ?? []).join(' ')],
      ]),
      line(
        c.subjects.flatMap(([, m, g], k): Array<[number, string]> => [
          [70 + 9 * k, marks(m)],
          [75 + 9 * k, g],
        ]),
      ),
    );
  }
  return out.join('\r\n');
}

const f = (line: number, start: number, width: number) => ({ line, start, width });

/** The layout that reads gazetteNewX — what a correct AI reply describes. */
export const NEW_X_LAYOUT = {
  recordStart: '^\\d{8} ',
  linesPerRecord: 2,
  roll: f(0, 0, 8),
  flag: f(0, 10, 1),
  sex: f(0, 13, 1),
  name: f(0, 15, 55),
  subjects: [0, 1, 2, 3, 4, 5].map((k) => ({
    code: f(0, 70 + 9 * k, 3),
    marks: f(1, 70 + 9 * k, 3),
    grade: f(1, 75 + 9 * k, 2),
  })),
  internalGrades: [],
  result: f(0, 126, 12),
  compartment: f(0, 139, 20),
  absentMarks: ['AB'],
  notes: 'Six subject slots nine columns apart; grades five columns right of the marks.',
};

/** A wrong reply: the subject columns two to the left (codes cut, marks misread). */
export const WRONG_X_LAYOUT = {
  ...NEW_X_LAYOUT,
  subjects: NEW_X_LAYOUT.subjects.map((s) => ({
    code: f(0, s.code.start - 2, 3),
    marks: f(1, s.marks.start - 2, 3),
    grade: s.grade,
  })),
  notes: '',
};

/** Ten made-up Class X candidates (first two are the e2e's own students). */
export function sampleX(rolls: string[], names: string[]): FixtureCandidate[] {
  const subjects = (k: number): Array<[string, string, string]> => [
    ['184', String(70 + k), 'B1'],
    ['085', String(80 + k), 'A2'],
    ['041', String(60 + k * 2), 'B2'],
    ['086', String(90 - k), 'A1'],
    ['087', String(75 + k), 'B1'],
  ];
  return rolls.map((roll, k) => ({
    roll,
    flag: k % 3 === 0 ? 'I' : ' ',
    sex: k % 2 === 0 ? 'F' : 'M',
    name: names[k] ?? `TEST CANDIDATE ${String.fromCharCode(65 + k)}`,
    subjects: k === 4 ? [...subjects(k), ['402', 'AB', 'E']] : subjects(k),
    result: 'PASS',
  }));
}
