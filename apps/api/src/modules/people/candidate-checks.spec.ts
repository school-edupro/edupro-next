import {
  aadhaarOk,
  ageOn,
  checkCandidateRow,
  checkCandidateValues,
  scoreOk,
} from './candidate-checks';

const places = {
  states: [
    { name: 'Uttar Pradesh', country: 'India' },
    { name: 'Delhi', country: 'India' },
  ],
  cities: [
    { name: 'Noida', state: 'Uttar Pradesh' },
    { name: 'New Delhi', state: 'Delhi' },
  ],
};
const today = '2026-10-20';

describe('candidate checks', () => {
  it('an Aadhaar number needs its check digit: exactly one last digit fits', () => {
    const fits = [...'0123456789'].filter((d) => aadhaarOk(`23456789012${d}`));
    expect(fits).toHaveLength(1);
    expect(aadhaarOk('123456789012')).toBe(false);
    expect(aadhaarOk('2345678901')).toBe(false);
  });

  it('age 18 to 65 on the day; names in letters; the alternate mobile differs', () => {
    expect(ageOn('2008-10-21', today)).toBe(17);
    expect(ageOn('2008-10-20', today)).toBe(18);
    const e = checkCandidateValues(
      ['dob', 'first_name', 'last_name', 'alternate_mobile'],
      {
        dob: '2008-10-21',
        first_name: 'Asha2',
        last_name: "D'Souza-Rao",
        mobile: '9811111111',
        alternate_mobile: '9811111111',
      },
      places,
      today,
    );
    expect(e.dob).toMatch(/18 to 65: born between 21-10-1960 and 20-10-2008/);
    expect(e.first_name).toMatch(/letters only/);
    expect(e.last_name).toBeUndefined();
    expect(e.alternate_mobile).toMatch(/another number/);
    expect(
      checkCandidateValues(
        ['dob', 'first_name'],
        { dob: '1960-10-21', first_name: 'आशा' },
        places,
        today,
      ),
    ).toEqual({});
  });

  it('the city must be of the state, the state of the country; months under twelve; no future end date', () => {
    const e = checkCandidateValues(
      ['present_state', 'present_city', 'total_exp_months', 'last_employment_end'],
      {
        present_country: 'India',
        present_state: 'Uttar Pradesh',
        present_city: 'New Delhi',
        total_exp_months: 12,
        last_employment_end: '2026-10-21',
      },
      places,
      today,
    );
    expect(e).toMatchObject({
      present_city: "not a city of Uttar Pradesh in the school's list",
      total_exp_months: '0 to 11 months',
      last_employment_end: 'not a date in the future',
    });
    expect(e.present_state).toBeUndefined();
    expect(
      checkCandidateValues(
        ['present_state'],
        { present_country: 'Nepal', present_state: 'Delhi' },
        places,
        today,
      ).present_state,
    ).toBe('not a state of Nepal');
  });

  it('marks, years of passing, experience dates', () => {
    expect(['72', '72%', '72.5 %', '450/600', '8.2 CGPA', '9 cgpa'].every(scoreOk)).toBe(true);
    expect(['101%', '650/600', '11 CGPA', 'good'].some(scoreOk)).toBe(false);
    expect(
      checkCandidateRow('education', { passingYear: '2027', score: '72%' }, '1991-02-03', today),
    ).toEqual({ passingYear: 'not a year in the future' });
    expect(
      checkCandidateRow('education', { passingYear: '2003', score: 'x' }, '1991-02-03', today),
    ).toEqual({
      passingYear: 'a year after you were 14',
      score: expect.stringMatching(/percentage/),
    });
    expect(
      checkCandidateRow(
        'experience',
        { fromOn: '2020-04-01', toOn: '2019-03-31' },
        '1991-02-03',
        today,
      ),
    ).toEqual({ toOn: 'on or after From' });
    expect(checkCandidateRow('experience', { fromOn: '2026-11-01' }, '1991-02-03', today)).toEqual({
      fromOn: 'not a date in the future',
    });
  });
});
