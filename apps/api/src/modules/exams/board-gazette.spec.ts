import {
  gazetteNewX,
  gazetteX,
  gazetteXII,
  NEW_X_LAYOUT,
  sampleX,
  WRONG_X_LAYOUT,
} from '../../../test/board-gazette-fixture';
import {
  BUILT_IN_LAYOUTS,
  builtInFingerprint,
  fingerprintOf,
  layoutFits,
  layoutProblems,
  LayoutZ,
  maskedSample,
  readGazette,
  ruler,
  type GazetteLayout,
} from './board-gazette';

const builtIn = (key: string) => BUILT_IN_LAYOUTS.find((b) => b.key === key)!;
const X = builtIn('builtin:cbse-x-2026');
const XII = builtIn('builtin:cbse-xii-2026');
const rolls = ['26100001', '26100002', '26100003', '26100004', '26100005', '26100006'];

describe('CBSE result gazette (docs/design/88, phase A)', () => {
  it('reads the Class X layout: every field, absent marks, the fingerprint of the built-in layout', () => {
    const text = gazetteX(sampleX(rolls, ['ASHA TEST', 'RAVI TEST']));
    expect(fingerprintOf(text)).toBe(builtInFingerprint(X));
    const r = readGazette(text, X.layout);
    expect(layoutFits(r)).toEqual({ ok: true, total: 6, bad: 0 });
    expect(r.problems).toEqual([]);
    expect(r.candidates[0]).toMatchObject({
      roll: '26100001',
      flag: 'I',
      sex: 'F',
      name: 'ASHA TEST',
      result: 'PASS',
      compartment: [],
    });
    expect(r.candidates[0]!.subjects.map((s) => [s.code, s.marks, s.grade])).toEqual([
      ['184', 70, 'B1'],
      ['085', 80, 'A2'],
      ['041', 60, 'B2'],
      ['086', 90, 'A1'],
      ['087', 75, 'B1'],
    ]);
    // the fifth candidate has a sixth subject marked absent
    expect(r.candidates[4]!.subjects[5]).toMatchObject({
      code: '402',
      absent: true,
      marks: null,
      grade: 'E',
    });
  });

  it('reads the Class XII layout: internal grades, compartment subjects, a blank marks line kept without error', () => {
    const text = gazetteXII([
      {
        roll: '26200001',
        sex: 'M',
        name: 'KABIR TEST',
        subjects: [
          ['301', '88', 'A2'],
          ['041', '95', 'A1'],
          ['042', '76', 'B1'],
          ['043', '81', 'A2'],
          ['083', '90', 'A1'],
        ],
        internal: ['A1', 'A1', 'B1'],
        result: 'PASS',
      },
      {
        roll: '26200002',
        sex: 'F',
        name: 'MEERA TEST',
        subjects: [
          ['301', '45', 'C2'],
          ['041', '21', 'E'],
          ['042', '30', 'E'],
          ['043', '52', 'C1'],
          ['083', '61', 'B2'],
        ],
        internal: ['A2', 'A1', 'A1'],
        result: 'COMP',
        compartment: ['041', '042'],
      },
      {
        roll: '26200003',
        sex: 'M',
        name: 'NOOR TEST',
        subjects: [
          ['301', '', ''],
          ['041', '', ''],
          ['042', '', ''],
          ['043', '', ''],
          ['083', '', ''],
        ],
        result: 'UFM',
      },
    ]);
    expect(fingerprintOf(text)).toBe(builtInFingerprint(XII));
    const r = readGazette(text, XII.layout);
    expect(r.problems).toEqual([]);
    expect(r.candidates[0]!.internalGrades).toEqual(['A1', 'A1', 'B1']);
    expect(r.candidates[1]).toMatchObject({ result: 'COMP', compartment: ['041', '042'] });
    expect(r.candidates[2]!.subjects.every((s) => s.marks === null && !s.absent)).toBe(true);
    expect(r.candidates[2]!.result).toBe('UFM');
  });

  it('checks every record: bad marks, a bad grade, a duplicate roll number (errors); an unknown result word (warning)', () => {
    const cands = sampleX(rolls.slice(0, 3), []);
    cands[0]!.subjects[1] = ['085', '1O5', 'A1'];
    cands[1]!.subjects[2] = ['041', '77', 'Z9'];
    cands[2]!.roll = cands[0]!.roll;
    cands[2]!.result = 'WAITS';
    const r = readGazette(gazetteX(cands), X.layout);
    const err = r.problems.filter((p) => p.level === 'error').map((p) => p.message);
    expect(err).toEqual([
      'Marks "1O5" are not 0–100 or absent',
      'Grade "Z9" is not a CBSE grade',
      'The roll number appears twice',
    ]);
    expect(r.problems.find((p) => p.level === 'warning')!.message).toMatch(
      /WAITS.*not a known word/,
    );
    expect(layoutFits(r)).toMatchObject({ ok: false, bad: 3 });
  });

  it('a known layout does not fit a moved one (cut-off codes); the right layout reads it, a wrong one does not', () => {
    const text = gazetteNewX(sampleX(rolls, []));
    expect(fingerprintOf(text)).not.toBe(builtInFingerprint(X));
    expect(layoutFits(readGazette(text, X.layout)).ok).toBe(false);
    const right = readGazette(text, NEW_X_LAYOUT as GazetteLayout);
    expect(layoutFits(right)).toEqual({ ok: true, total: 6, bad: 0 });
    expect(right.candidates[1]!.subjects[0]).toMatchObject({ code: '184', marks: 71 });
    expect(layoutFits(readGazette(text, WRONG_X_LAYOUT as GazetteLayout)).ok).toBe(false);
  });

  it('what the AI may see: headings, result words and grades kept; names, roll numbers and marks masked, columns in place', () => {
    const text = gazetteX(sampleX(rolls, ['ASHA TEST', 'RAVI TEST']));
    const s = maskedSample(text);
    expect(s.text).toContain('NAME OF CANDIDATE');
    expect(s.text).toContain('SUB CD');
    expect(s.text).toContain('PASS');
    expect(s.text).toMatch(/\bB1\b/);
    for (const secret of [
      'ASHA',
      'RAVI',
      'SAMPLE PUBLIC',
      'SAMPLE-REGION',
      '26100001',
      '070',
      '18-07-2026',
    ])
      expect(s.text).not.toContain(secret);
    expect(s.masked).toBeGreaterThan(4);
    // every masked record line keeps its width, so columns stay where they were
    const original = text.split('\r\n').find((l) => l.startsWith('26100001'))!;
    const masked = s.text.split('\n').find((l) => /^9{8}/.test(l))!;
    expect(masked.length).toBe(original.length);
    expect(masked.indexOf('XXXX')).toBe(original.indexOf('ASHA'));
    expect(ruler(25).split('\n')[1]).toBe('0123456789012345678901234');
  });

  it('validates a proposed layout: the schema, and fields inside the record', () => {
    expect(LayoutZ.safeParse(NEW_X_LAYOUT).success).toBe(true);
    expect(LayoutZ.safeParse({ ...NEW_X_LAYOUT, subjects: [] }).success).toBe(false);
    const parsed = LayoutZ.parse(NEW_X_LAYOUT) as GazetteLayout;
    expect(layoutProblems(parsed)).toEqual([]);
    expect(
      layoutProblems({
        ...parsed,
        result: { line: 2, start: 120, width: 4 },
        roll: { line: 0, start: 0, width: 0 },
      }),
    ).toEqual(['result is on line 2 of a 2-line record', 'No roll number field']);
  });
});
