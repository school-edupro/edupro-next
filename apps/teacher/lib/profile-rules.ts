import type { MyField, MyListColumn } from './my-profile';

/**
 * The checks of My profile's inputs in the browser, the server's own (apps/api/src/modules/people/employee-self-rules.ts
 * and each field's format): what the input needs before the form is sent, as HTML attributes — the browser says what
 * is wrong next to the field. The server checks again.
 */
export interface InputRules {
  type?: string;
  inputMode?: 'numeric' | 'tel' | 'email' | 'text';
  required?: boolean;
  pattern?: string;
  title?: string;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
  step?: number;
}

const NAMES = new Set([
  'first_name',
  'last_name',
  'spouse_name',
  'father_name',
  'emergency_name',
  'bank_account_name',
]);

/** Today in India, and a year shift of it, as YYYY-MM-DD. */
export function istDay(yearsBack = 0): string {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCFullYear(d.getUTCFullYear() - yearsBack);
  return d.toISOString().slice(0, 10);
}

/** The rules of one profile field (a field waiting for approval is disabled and not checked). */
export function fieldRules(f: MyField): InputRules {
  const r: InputRules = { required: f.required, maxLength: 300 };
  if (NAMES.has(f.key))
    return {
      ...r,
      pattern: "[A-Za-z][A-Za-z .'\\-]*",
      title: "Letters, spaces and . ' - only",
      maxLength: 120,
    };
  switch (f.type) {
    case 'mobile':
      return {
        ...r,
        type: 'tel',
        inputMode: 'numeric',
        pattern: '[6-9][0-9]{9}',
        title: '10-digit mobile starting 6-9, no +91 or 0',
        maxLength: 10,
      };
    case 'email':
      return { ...r, type: 'email', inputMode: 'email', title: 'A valid email address' };
    case 'digits12':
      return {
        ...r,
        inputMode: 'numeric',
        pattern: '[0-9]{12}',
        title: '12 digits, no spaces',
        maxLength: 12,
      };
    case 'pan':
      return {
        ...r,
        pattern: '[A-Za-z]{5}[0-9]{4}[A-Za-z]',
        title: '10 characters, e.g. ABCDE1234F',
        maxLength: 10,
      };
    case 'ifsc':
      return {
        ...r,
        pattern: '[A-Za-z]{4}0[A-Za-z0-9]{6}',
        title: '11 characters, 5th is 0, e.g. SBIN0001234',
        maxLength: 11,
      };
    case 'account':
      return {
        ...r,
        inputMode: 'numeric',
        pattern: '[0-9]{9,18}',
        title: '9 to 18 digits',
        maxLength: 18,
      };
    case 'number':
      return f.key === 'sons' || f.key === 'daughters'
        ? { ...r, type: 'number', min: 0, max: 20, step: 1, title: 'A whole number from 0 to 20' }
        : { ...r, type: 'number', min: 0, title: 'A number of 0 or more' };
    case 'date':
      if (f.key === 'dob')
        return {
          ...r,
          type: 'date',
          min: istDay(80),
          max: istDay(18),
          title: 'The age must be from 18 to 80',
        };
      if (f.key === 'anniversary')
        return { ...r, type: 'date', max: istDay(), title: 'Cannot be in the future' };
      return { ...r, type: 'date' };
    default:
      if (f.key === 'phone')
        return {
          ...r,
          type: 'tel',
          pattern: '\\+?[0-9 \\-]{6,20}',
          title: 'A phone number of 6 to 15 digits',
          maxLength: 20,
        };
      return r;
  }
}

/** The list columns that record what already happened (not after today). */
const PAST_DATES = new Set(['fromOn', 'toOn', 'trainedOn', 'enteredOn', 'issuedOn']);

/** The rules of one column of a list row. */
export function columnRules(c: MyListColumn): InputRules {
  if (c.type === 'year')
    return {
      type: 'number',
      min: 1940,
      max: Number(istDay().slice(0, 4)),
      step: 1,
      title: `A year from 1940 to ${istDay().slice(0, 4)}`,
    };
  if (c.type === 'date')
    return PAST_DATES.has(c.key)
      ? { type: 'date', max: istDay(), title: 'Cannot be in the future' }
      : { type: 'date' };
  return {};
}
