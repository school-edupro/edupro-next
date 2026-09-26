import { describe, expect, it } from 'vitest';
import {
  combineDateTime,
  istToUtc,
  normaliseCode,
  normaliseDate,
  normaliseEmail,
  normaliseMobile,
  normaliseMonth,
  normaliseStatus,
  normaliseYearCode,
  phpUnserialize,
  repairMojibake,
  splitLegacySection,
  toMoney,
  trashToDeletedAt,
  unwrap,
  yesNoToBoolean,
} from '../src';

describe('normaliseYearCode', () => {
  it.each([
    ['2025', '2025-26'],
    ['2025-26', '2025-26'],
    ['2025-2026', '2025-26'],
    ['2025/26', '2025-26'],
    ['25-26', '2025-26'],
    [' 2024 ', '2024-25'],
    ['2099', '2099-00'],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(normaliseYearCode(input))).toBe(expected);
  });

  it('rejects non-consecutive and empty years as blocking', () => {
    expect(normaliseYearCode('2025-27')).toMatchObject({ kind: 'reject', reason: 'year.non_consecutive', blocking: true });
    expect(normaliseYearCode('')).toMatchObject({ kind: 'reject', blocking: true });
    expect(normaliseYearCode('Session')).toMatchObject({ kind: 'reject', reason: 'year.unparseable' });
  });
});

describe('splitLegacySection', () => {
  it.each([
    ['VI-A', 'VI', 'A'],
    ['XI-Sci-A', 'XI-SCI', 'A'],
    ['Nursery-B', 'NURSERY', 'B'],
    ['XII-Com-C1', 'XII-COM', 'C1'],
    ['VI', 'VI', null],
    ['Pre-Nursery', 'PRE-NURSERY', null],
  ])('%s -> %s / %s', (input, classCode, section) => {
    expect(unwrap(splitLegacySection(input))).toEqual({ classCode, section });
  });
});

describe('status and booleans', () => {
  it.each([
    ['Active', 'active'],
    ['1', 'active'],
    [1, 'active'],
    ['Yes', 'active'],
    ['InActive', 'inactive'],
    ['0', 'inactive'],
    ['No', 'inactive'],
    ['', null],
    [null, null],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(normaliseStatus(input))).toBe(expected);
  });

  it('rejects workflow strings so module ETL handles them', () => {
    expect(normaliseStatus('Approved')).toMatchObject({ kind: 'reject', reason: 'status.unknown' });
  });

  it('maps yes/no to booleans', () => {
    expect(unwrap(yesNoToBoolean('Y'))).toBe(true);
    expect(unwrap(yesNoToBoolean('N'))).toBe(false);
    expect(unwrap(yesNoToBoolean(null))).toBeNull();
  });
});

describe('mobile and email', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['09876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['1234567890, 9876543210', '9876543210'],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(normaliseMobile(input))).toBe(expected);
  });

  it('rejects numbers that are not Indian mobiles', () => {
    expect(normaliseMobile('12345')).toMatchObject({ kind: 'reject', reason: 'mobile.invalid' });
  });

  it('lower-cases and validates emails', () => {
    expect(unwrap(normaliseEmail(' Parent@Example.COM '))).toBe('parent@example.com');
    expect(normaliseEmail('not-an-email')).toMatchObject({ kind: 'reject' });
  });
});

describe('dates and times', () => {
  it.each([
    ['2025-04-01', '2025-04-01'],
    ['2025-04-01 10:30:00', '2025-04-01'],
    ['01/04/2025', '2025-04-01'],
    ['01-04-2025', '2025-04-01'],
    ['31.12.2024', '2024-12-31'],
    ['0000-00-00', null],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(normaliseDate(input))).toBe(expected);
  });

  it('rejects impossible dates', () => {
    expect(normaliseDate('31/02/2025')).toMatchObject({ kind: 'reject', reason: 'date.invalid' });
    expect(normaliseDate('2025-13-01')).toMatchObject({ kind: 'reject', reason: 'date.out_of_range' });
  });

  it('converts IST datetimes to UTC', () => {
    expect(unwrap(istToUtc('2025-04-01 05:30:00'))).toBe('2025-04-01T00:00:00.000Z');
    expect(unwrap(istToUtc('2025-04-01 00:15'))).toBe('2025-03-31T18:45:00.000Z');
  });

  it('combines split legacy date and time columns', () => {
    expect(unwrap(combineDateTime('01/04/2025', '10:30 AM'))).toBe('2025-04-01T05:00:00.000Z');
    expect(unwrap(combineDateTime('2025-04-01', '12:05 PM'))).toBe('2025-04-01T06:35:00.000Z');
    expect(unwrap(combineDateTime('2025-04-01', null))).toBe('2025-03-31T18:30:00.000Z');
  });
});

describe('money and months', () => {
  it.each([
    ['1,250.50', '1250.50'],
    ['₹ 1,250', '1250.00'],
    [1250.555, '1250.56'],
    ['-40', '-40.00'],
    ['', null],
    [null, null],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(toMoney(input))).toBe(expected);
  });

  it('rejects non-numeric money as blocking', () => {
    expect(toMoney('twelve')).toMatchObject({ kind: 'reject', reason: 'money.invalid', blocking: true });
  });

  it.each([
    ['April', 4],
    ['apr', 4],
    ['4', 4],
    ['12', 12],
    ['Sept', 9],
  ])('%s -> %s', (input, expected) => {
    expect(unwrap(normaliseMonth(input))).toBe(expected);
  });
});

describe('codes, trash, mojibake, php', () => {
  it('normalises admission numbers and employee codes', () => {
    expect(unwrap(normaliseCode(' r24560 '))).toBe('R24560');
    expect(normaliseCode('')).toMatchObject({ kind: 'reject', blocking: true });
  });

  it('derives deleted_at from isTrash', () => {
    expect(trashToDeletedAt('1', '2025-04-01 10:00:00', '2026-01-01T00:00:00.000Z')).toBe('2025-04-01T04:30:00.000Z');
    expect(trashToDeletedAt('1', null, '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
    expect(trashToDeletedAt('0', '2025-04-01 10:00:00', '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('repairs double-encoded UTF-8 and leaves clean text alone', () => {
    expect(repairMojibake('Ã ')).toBe('à');
    expect(repairMojibake('Delhi Public School')).toBe('Delhi Public School');
  });

  it('reads PHP serialised arrays', () => {
    expect(unwrap(phpUnserialize('a:2:{i:0;s:3:"S12";i:1;s:3:"S16";}'))).toEqual(['S12', 'S16']);
    expect(unwrap(phpUnserialize('a:1:{s:4:"mode";s:7:"daywise";}'))).toEqual({ mode: 'daywise' });
    expect(phpUnserialize('garbage')).toMatchObject({ kind: 'reject' });
  });
});
