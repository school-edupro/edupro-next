import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  cleanAnswers,
  defProblems,
  fieldError,
  fieldState,
  formErrors,
  formProgress,
  linkCityStates,
  visibleSteps,
  type AdmissionAnswers,
  type AdmissionField,
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
    expect(fieldState(field(G, 'father_name'), a).required).toBe(false);
    expect(fieldState(field(G, 'mother_name'), a).required).toBe(true);
    expect(fieldState(field(G, 'father_photo'), a).required).toBe(false);
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
    const s = G.settings;
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
});
