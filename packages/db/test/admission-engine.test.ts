import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  cleanAnswers,
  conditionsHold,
  matchCategory,
  pointsTotal,
  workPoints,
  defProblems,
  fieldError,
  fieldState,
  formErrors,
  formProgress,
  linkCityStates,
  visibleSteps,
  type AdmissionAnswers,
  type AdmissionField,
  type PointTables,
} from '../src/admission-engine';
import { CLASS_XI_ADMISSION_FORM, GENERAL_ADMISSION_FORM } from '../src/admission-form-templates';

const G = GENERAL_ADMISSION_FORM;
const XI = CLASS_XI_ADMISSION_FORM;
const field = (def: typeof G, key: string) => def.fields.find((f) => f.key === key)!;
const opts = (f: AdmissionField) => f.options;

describe('admission form engine (docs/design/39)', () => {
  it('the ready forms are valid and the UI copy is in step', () => {
    expect(defProblems(G)).toEqual([]);
    expect(defProblems(XI)).toEqual([]);
    const db = readFileSync(join(__dirname, '../src/admission-engine.ts'), 'utf8');
    const ui = readFileSync(join(__dirname, '../../ui/src/admission-engine.ts'), 'utf8');
    expect(ui.split('\n').slice(1).join('\n')).toBe(db);
  });

  it('works out the age as on the reference date', () => {
    expect(ageOn('2014-06-15', '2027-03-31')).toMatchObject({ years: 12, months: 9, days: 16 });
    expect(ageOn('2012-03-31', '2027-03-31')?.text).toBe('15 Years 0 Months 0 Days');
    expect(ageOn('2030-01-01', '2027-03-31')).toBeNull();
  });

  it('single parent, staff child, special needs and alumni drive the fields', () => {
    const a: AdmissionAnswers = { single_parent: 'Mother Only' };
    // the other parent is not asked at all: their fields, their photo and their tab go
    expect(fieldState(field(G, 'father_name'), a)).toEqual({ shown: false, required: false });
    expect(fieldState(field(G, 'mother_name'), a).required).toBe(true);
    expect(fieldState(field(G, 'father_photo'), a)).toEqual({ shown: false, required: false });
    expect(fieldState(field(G, 'mother_photo'), a)).toEqual({ shown: true, required: true });
    expect(visibleSteps(G, a).map((s) => s.key)).not.toContain('father');
    expect(visibleSteps(G, { single_parent: 'Father Only' }).map((s) => s.key)).not.toContain(
      'mother',
    );
    // a "Yes" left in the father's alumnus field does not bring his tab back
    const left: AdmissionAnswers = { single_parent: 'Mother Only', father_alumnus: 'Yes' };
    expect(visibleSteps(G, left).map((s) => s.key)).not.toContain('father');
    expect(cleanAnswers(G, left)).not.toHaveProperty('father_alumnus');
    expect(visibleSteps(G, {}).map((s) => s.key)).toEqual(
      expect.arrayContaining(['father', 'mother']),
    );
    expect(fieldState(field(G, 'father_staff_school'), {}).shown).toBe(false);
    expect(fieldState(field(G, 'father_staff_school'), { staff_child: 'Both' }).shown).toBe(true);
    expect(fieldState(field(G, 'mother_staff_school'), { staff_child: 'Father' }).shown).toBe(
      false,
    );
    expect(fieldState(field(G, 'type_of_disability'), { cwsn: 'Yes' })).toEqual({
      shown: true,
      required: true,
    });
    expect(fieldState(field(G, 'father_cbse_roll'), { father_alumnus: 'No' }).shown).toBe(false);
    expect(fieldState(field(G, 'mother_maiden_name'), { mother_alumnus: 'Yes' }).required).toBe(
      true,
    );
  });

  it('uses the school wording for the checks', () => {
    // the PIN codes come from the session's class line (merged into the settings by the API)
    const s = { ...G.settings, pincodePrefixes: ['110', '122', '121', '201', '250', '124'] };
    expect(fieldError(field(G, 'sms_mobile'), { sms_mobile: '5123456789' }, s)).toBe(
      'Invalid mobile number. Must start with 6,7,8 or 9',
    );
    expect(fieldError(field(G, 'sms_mobile'), { sms_mobile: '98765' }, s)).toBe(
      'Please enter 10 digit mobile number',
    );
    expect(fieldError(field(G, 'aadhaar_no'), { aadhaar_no: '1234' }, s)).toBe(
      'Please enter 12 digit Aadhar number',
    );
    expect(
      fieldError(field(G, 'residential_pin_code'), { residential_pin_code: '400001' }, s),
    ).toMatch(/^Enter valid pincode starting with following series only "110XXX"/);
    expect(
      fieldError(field(G, 'residential_pin_code'), { residential_pin_code: '110022' }, s),
    ).toBeNull();
    expect(fieldError(field(G, 'primary_email'), { primary_email: 'x@y' }, s)).toBe(
      'Please enter a valid email address!',
    );
    expect(fieldError(field(G, 'father_name'), { father_name: 'Dr. Amit' }, s)).toBe(
      'Avoid titles like Mr., Mrs., Dr., Prof.',
    );
    expect(fieldError(field(G, 'dob'), {}, s)).toBe('Date Of Birth is mandatory!');
    expect(
      fieldError(
        { ...field(G, 'father_passout_year'), rules: [] },
        { father_passout_year: '2030' },
        { passOutBefore: 2027 },
      ),
    ).toBe('Pass out year must be less than 2027');
    expect(
      fieldError(
        field(XI, 'dob'),
        { dob: '2008-01-01' },
        { dobFrom: '2009-04-01', dobTo: '2012-03-31' },
      ),
    ).toBe('DOB must be between 01-04-2009 & 31-03-2012 !');
  });

  it('siblings: exactly the chosen number, each with an admission no', () => {
    const f = field(G, 'siblings');
    expect(
      fieldError(
        f,
        { siblings: { count: 2, list: [{ admissionNo: 'A1' }, { admissionNo: '' }] } },
        G.settings,
      ),
    ).toBe('Please enter Admission No (Sibling 2)!');
    expect(fieldError(f, { siblings: { count: 0, list: [] } }, G.settings)).toBeNull();
    expect(
      fieldState(field(G, 'sibling_proof'), {
        siblings: { count: 1, list: [{ admissionNo: 'A1' }] },
      }).required,
    ).toBe(true);
    expect(fieldState(field(G, 'sibling_proof'), { siblings: { count: 0, list: [] } }).shown).toBe(
      false,
    );
  });

  it('Class XI: subjects by stream without repeats, marks cut-offs per stream', () => {
    const subj = field(XI, 'subjects');
    const pcm = { stream: 'Science (PCM)' };
    expect(
      fieldError(
        subj,
        {
          ...pcm,
          subjects: ['English', 'Mathematics', 'Physics', 'Chemistry', 'Computer Science'],
        },
        XI.settings,
      ),
    ).toBeNull();
    expect(
      fieldError(
        subj,
        { ...pcm, subjects: ['English', 'Mathematics', 'Physics', 'Economics', 'Economics'] },
        XI.settings,
      ),
    ).toBe('The same subject cannot be chosen twice');
    expect(
      fieldError(
        subj,
        { ...pcm, subjects: ['English', 'Painting', 'Physics', 'Chemistry', 'Yoga'] },
        XI.settings,
      ),
    ).toBe('Subject 2: choose from the list');
    const marks = field(XI, 'class_x_marks');
    const m = (eng: number, maths: number, sci: number, mathsSubject = 'Standard Mathematics') => ({
      english: { marks: eng },
      maths: { marks: maths, subject: mathsSubject },
      science: { marks: sci },
      social: { marks: 80 },
      language: { marks: 80, subject: 'Hindi' },
    });
    expect(fieldError(marks, { ...pcm, class_x_marks: m(90, 90, 90) }, XI.settings)).toBeNull();
    expect(fieldError(marks, { ...pcm, class_x_marks: m(70, 90, 90) }, XI.settings)).toBe(
      'For SCIENCE STREAM, you need a minimum of 75% in English, Science, and Mathematics.',
    );
    expect(
      fieldError(marks, { ...pcm, class_x_marks: m(90, 90, 90, 'Basic Mathematics') }, XI.settings),
    ).toMatch(/SCIENCE STREAM/);
    expect(
      fieldError(marks, { stream: 'Humanities', class_x_marks: m(60, 60, 60) }, XI.settings),
    ).toBe('For HUMANITIES STREAM, you need an aggregate of 75% or above in 5 subjects.');
    expect(
      fieldError(marks, { stream: 'Humanities', class_x_marks: m(80, 70, 70) }, XI.settings),
    ).toBeNull();
  });

  it('progress, cleaning and steps', () => {
    expect(formProgress(G, {})).toBe(0);
    const clean = cleanAnswers(G, {
      first_name: ' riya ',
      primary_email: 'A@B.COM',
      staff_child: 'Father',
      father_staff_school: 'X',
      mother_staff_school: 'Y',
      dob: '2014-06-15',
    });
    expect(clean.first_name).toBe('RIYA');
    expect(clean.primary_email).toBe('a@b.com');
    expect(clean.mother_staff_school).toBeUndefined();
    expect(visibleSteps(G, {}).length).toBe(8);
    const errs = formErrors(G, {}, opts, 'student');
    expect(Object.keys(errs)).toContain('first_name');
    expect(Object.keys(errs)).not.toContain('father_staff_school');
  });

  it('a city list follows the state on its tab; set, linked by itself, or any city', () => {
    const base = {
      ...G,
      steps: [
        { key: 'father', title: 'Father' },
        { key: 'mother', title: 'Mother' },
      ],
      fields: [
        { key: 'f_state', label: 'Office State', type: 'select', step: 'father', source: 'states' },
        { key: 'f_city', label: 'Office City', type: 'select', step: 'father', source: 'cities' },
        { key: 'm_state', label: 'Office State', type: 'select', step: 'mother', source: 'states' },
        {
          key: 'm_city',
          label: 'Office City',
          type: 'select',
          step: 'mother',
          source: 'cities',
          dependsOn: 'm_state',
        },
        {
          key: 'any_city',
          label: 'Born in',
          type: 'select',
          step: 'mother',
          source: 'cities',
          dependsOn: '',
        },
      ],
    } as typeof G;
    const linked = linkCityStates(base);
    expect(linked.fields.find((f) => f.key === 'f_city')!.dependsOn).toBe('f_state');
    expect(linked.fields.find((f) => f.key === 'm_city')!.dependsOn).toBe('m_state');
    expect(linked.fields.find((f) => f.key === 'any_city')!.dependsOn).toBe('');
    expect(defProblems(linked)).toEqual([]);
    const bad = {
      ...base,
      fields: base.fields.map((f) => (f.key === 'f_city' ? { ...f, dependsOn: 'm_city' } : f)),
    } as typeof G;
    expect(defProblems(bad)).toEqual([
      'Office City: it can follow only a state field (Office City is not one)',
    ]);
    // the server's check uses the chosen state's cities
    const all: Record<string, string[]> = {
      '@cities': ['Pune', 'Lucknow'],
      '@cities@Maharashtra': ['Pune'],
      '@cities@Uttar Pradesh': ['Lucknow'],
    };
    const cityOpts = (f: AdmissionField, a: AdmissionAnswers) =>
      f.source === 'cities' && f.dependsOn
        ? typeof a[f.dependsOn] === 'string' && a[f.dependsOn]
          ? (all[`@cities@${String(a[f.dependsOn])}`] ?? all['@cities'])
          : []
        : f.source
          ? all[`@${f.source}`]
          : undefined;
    const wrong = formErrors(
      linked,
      { f_state: 'Maharashtra', f_city: 'Lucknow' },
      cityOpts,
      'father',
    );
    expect(wrong).toHaveProperty('f_city');
    const right = formErrors(
      linked,
      { f_state: 'Maharashtra', f_city: 'Pune' },
      cityOpts,
      'father',
    );
    expect(right).not.toHaveProperty('f_city');
  });

  it('compares numbers with at least / at most, and a blank answer is not 0', () => {
    const near = [{ field: 'distance_km', op: 'lte' as const, value: '3' }];
    expect(conditionsHold(near, 'all', { distance_km: '2.5' })).toBe(true);
    expect(conditionsHold(near, 'all', { distance_km: '3' })).toBe(true);
    expect(conditionsHold(near, 'all', { distance_km: '4' })).toBe(false);
    expect(conditionsHold(near, 'all', {})).toBe(false);
    const sib = [{ field: 'siblings', op: 'gte' as const, value: '1' }];
    expect(conditionsHold(sib, 'all', { siblings: { count: 2, list: [] } })).toBe(true);
    expect(conditionsHold(sib, 'all', { siblings: { count: 0, list: [] } })).toBe(false);
    expect(conditionsHold([{ field: 'x', op: 'lt', value: '5' }], 'all', { x: '' })).toBe(false);
  });

  it('a yes / no switch (true / false) matches a rule written Yes / No', () => {
    const ews = [{ field: 'ews', op: 'eq' as const, value: 'Yes' }];
    // the EWS question added as a switch keeps true: the family is EWS / DG, not General
    expect(conditionsHold(ews, 'any', { ews: true })).toBe(true);
    expect(conditionsHold(ews, 'any', { ews: false })).toBe(false);
    expect(conditionsHold(ews, 'any', { ews: 'Yes' })).toBe(true);
    expect(conditionsHold([{ field: 'ews', op: 'eq', value: 'No' }], 'any', { ews: false })).toBe(
      true,
    );
    expect(conditionsHold([{ field: 'ews', op: 'eq', value: 'true' }], 'any', { ews: true })).toBe(
      true,
    );
    expect(conditionsHold([{ field: 'ews', op: 'neq', value: 'Yes' }], 'any', { ews: true })).toBe(
      false,
    );
    const cats = [
      { id: 'g', isDefault: true, logic: 'any' as const, conditions: [] },
      { id: 'e', isDefault: false, logic: 'any' as const, conditions: ews },
    ];
    expect(matchCategory(cats, { ews: true })?.id).toBe('e');
    expect(matchCategory(cats, { ews: false })?.id).toBe('g');
  });

  it('works merit points out per criterion, deductions included', () => {
    const lines = workPoints(
      [
        {
          name: 'Sibling',
          logic: 'all',
          conditions: [{ field: 'siblings', op: 'gte', value: '1' }],
          points: 20,
        },
        {
          name: 'Alumni parent',
          logic: 'any',
          conditions: [
            { field: 'father_alumnus', op: 'eq', value: 'Yes' },
            { field: 'mother_alumnus', op: 'eq', value: 'Yes' },
          ],
          points: 10,
        },
        {
          name: 'Late transfer',
          logic: 'all',
          conditions: [{ field: 'late', op: 'eq', value: 'Yes' }],
          points: -2.5,
        },
      ],
      { siblings: { count: 1, list: [] }, mother_alumnus: 'Yes', late: 'Yes' },
    );
    expect(lines.map((l) => [l.name, l.auto])).toEqual([
      ['Sibling', 20],
      ['Alumni parent', 10],
      ['Late transfer', -2.5],
    ]);
    expect(pointsTotal(lines)).toBe(27.5);
    expect(pointsTotal(workPoints([], {}))).toBe(0);
  });

  // docs/design/48: points read from the school's score tables, capped, checked
  const tables: PointTables = {
    qualification: (n) =>
      ({ 'b.ed': { father: 13, mother: 14 }, 'l.l.b': { father: 13, mother: 14 } })[
        n.toLowerCase()
      ] ?? null,
    locality: (n) => ({ 'sunder vihar': 30, 'beyond 15 km': 20 })[n.toLowerCase()] ?? null,
    alumni: (school, passout) =>
      school === 'DPS - Faridabad'
        ? (({ '12': 12, '10': 12 } as Record<string, number>)[passout] ?? null)
        : null,
    most: (table, role) =>
      table === 'qualification' ? (role === 'mother' ? 14 : 13) : table === 'locality' ? 30 : 12,
    siblingFound: (nos) => nos.includes('A100'),
  };

  it('adds both parents from the qualifications table and flags one not in it', () => {
    const [l] = workPoints(
      [
        {
          name: 'Education',
          logic: 'all',
          conditions: [],
          points: 0,
          kind: 'table',
          spec: {
            table: 'qualification',
            sources: [
              { role: 'father', field: 'father_education' },
              { role: 'mother', field: 'mother_education' },
            ],
          },
        },
      ],
      { father_education: 'B.Ed', mother_education: 'L.L.B' },
      tables,
    );
    expect(l).toEqual({ name: 'Education', max: 27, auto: 27, points: 27 });
    const [m] = workPoints(
      [
        {
          name: 'Education',
          logic: 'all',
          conditions: [],
          points: 0,
          kind: 'table',
          spec: {
            table: 'qualification',
            sources: [{ role: 'mother', field: 'mother_education' }],
          },
        },
      ],
      { mother_education: 'PhD' },
      tables,
    );
    expect(m!.points).toBe(0);
    expect(m!.check).toMatch(/Mother's qualification “PhD” is not in the table/);
  });

  it('scores the locality, caps alumni together, and checks a sibling and a proof', () => {
    const lines = workPoints(
      [
        {
          name: 'Distance',
          logic: 'all',
          conditions: [],
          points: 0,
          kind: 'table',
          spec: { table: 'locality', sources: [{ role: 'child', field: 'locality' }] },
        },
        {
          name: 'Alumni',
          logic: 'all',
          conditions: [],
          points: 0,
          kind: 'table',
          cap: 20,
          spec: {
            table: 'alumni_school',
            school: 'DPS - Faridabad',
            sources: [
              { role: 'father', field: '', classField: 'father_alumni_class' },
              { role: 'mother', field: '', classField: 'mother_alumni_class' },
            ],
          },
        },
        { name: 'Sibling', logic: 'all', conditions: [], points: 26, kind: 'sibling' },
        {
          name: 'Special child',
          logic: 'all',
          conditions: [{ field: 'cwsn', op: 'eq', value: 'Yes' }],
          points: 5,
          spec: { proof: 'cwsn_certificate' },
        },
      ],
      {
        locality: 'Sunder Vihar',
        father_alumni_class: '12',
        mother_alumni_class: '10',
        siblings: { count: 1, list: [{ admissionNo: 'B200' }] },
        cwsn: 'Yes',
      },
      tables,
    );
    expect(lines.map((l) => l.points)).toEqual([30, 20, 0, 0]);
    expect(lines[1]!.max).toBe(20);
    expect(lines[2]!.check).toMatch(/Sibling not found/);
    expect(lines[3]!.check).toBe('The proof is not uploaded');
    expect(pointsTotal(lines, 40)).toBe(40);
    expect(pointsTotal(lines)).toBe(50);
  });
});
