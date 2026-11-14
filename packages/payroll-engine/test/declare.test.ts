import { describe, expect, it } from 'vitest';
import { allowedDeductions, hraExemption, houseLoss } from '../src/declare';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));

describe('hraExemption', () => {
  it('is the least of the three', () => {
    // received 1,20,000; salary 6,00,000; rent 1,80,000: rent − 10 % = 1,20,000; 50 % = 3,00,000 → 1,20,000
    expect(
      hraExemption({
        hraReceived: R(120000),
        salary: R(600000),
        rentPaid: R(180000),
        listedCity: true,
      }),
    ).toBe(R(120000));
    // rent − 10 % is the least: 1,00,000 − 60,000 = 40,000
    expect(
      hraExemption({
        hraReceived: R(120000),
        salary: R(600000),
        rentPaid: R(100000),
        listedCity: false,
      }),
    ).toBe(R(40000));
    // two fifths elsewhere is the least: 40 % of 2,00,000 = 80,000
    expect(
      hraExemption({
        hraReceived: R(150000),
        salary: R(200000),
        rentPaid: R(300000),
        listedCity: false,
      }),
    ).toBe(R(80000));
    // half in a listed city: 1,00,000
    expect(
      hraExemption({
        hraReceived: R(150000),
        salary: R(200000),
        rentPaid: R(300000),
        listedCity: true,
      }),
    ).toBe(R(100000));
  });
  it('is nothing without rent, without HRA, or when the rent is under a tenth of the salary', () => {
    expect(
      hraExemption({ hraReceived: R(1000), salary: R(10000), rentPaid: 0n, listedCity: true }),
    ).toBe(0n);
    expect(
      hraExemption({ hraReceived: 0n, salary: R(10000), rentPaid: R(5000), listedCity: true }),
    ).toBe(0n);
    expect(
      hraExemption({
        hraReceived: R(1000),
        salary: R(100000),
        rentPaid: R(5000),
        listedCity: true,
      }),
    ).toBe(0n);
  });
});

describe('allowedDeductions', () => {
  const lines = [
    {
      code: 'CHAPVIA_80C',
      amount: R(120000),
      cap: R(150000),
      appliesTo: 'OLD' as const,
      group: 'G80C',
    },
    {
      code: 'CHAPVIA_80CCC',
      amount: R(50000),
      cap: R(150000),
      appliesTo: 'OLD' as const,
      group: 'G80C',
    },
    { code: 'CHAPVIA_80D', amount: R(40000), cap: R(25000), appliesTo: 'OLD' as const },
    { code: 'NPS_ER', amount: R(30000), cap: null, appliesTo: 'BOTH' as const },
    { code: 'OTHER', amount: -R(10), cap: null, appliesTo: 'BOTH' as const },
  ];
  it('keeps each line within its cap and the shared cap across its lines', () => {
    const r = allowedDeductions('OLD', lines, { G80C: R(150000) });
    expect(r.lines.map((l) => [l.code, l.allowed, l.cut])).toEqual([
      ['CHAPVIA_80C', R(120000), null],
      ['CHAPVIA_80CCC', R(30000), 'group'],
      ['CHAPVIA_80D', R(25000), 'cap'],
      ['NPS_ER', R(30000), null],
      ['OTHER', 0n, null],
    ]);
    expect(r.total).toBe(R(205000));
  });
  it('allows in the new regime only what it allows', () => {
    const r = allowedDeductions('NEW', lines, { G80C: R(150000) });
    expect(r.lines.map((l) => [l.code, l.allowed, l.cut])).toEqual([
      ['CHAPVIA_80C', 0n, 'regime'],
      ['CHAPVIA_80CCC', 0n, 'regime'],
      ['CHAPVIA_80D', 0n, 'regime'],
      ['NPS_ER', R(30000), null],
      ['OTHER', 0n, null],
    ]);
    expect(r.total).toBe(R(30000));
  });
  it('a group already full gives nothing more; a group without a cap is not limited', () => {
    const r = allowedDeductions(
      'OLD',
      [
        { code: 'A', amount: R(200000), cap: null, appliesTo: 'OLD', group: 'G' },
        { code: 'B', amount: R(1000), cap: null, appliesTo: 'OLD', group: 'G' },
        { code: 'C', amount: R(1000), cap: null, appliesTo: 'OLD', group: 'H' },
      ],
      { G: R(150000) },
    );
    expect(r.lines.map((l) => l.allowed)).toEqual([R(150000), 0n, R(1000)]);
  });
  it('a line of another regime with nothing declared is simply nothing', () => {
    expect(
      allowedDeductions('NEW', [{ code: 'X', amount: 0n, cap: null, appliesTo: 'OLD' }]).lines[0]!
        .cut,
    ).toBeNull();
  });
});

describe('houseLoss', () => {
  it('the old regime only, within its cap', () => {
    expect(houseLoss('OLD', R(250000), R(200000))).toBe(R(200000));
    expect(houseLoss('OLD', R(90000), R(200000))).toBe(R(90000));
    expect(houseLoss('NEW', R(90000), R(200000))).toBe(0n);
    expect(houseLoss('OLD', 0n, R(200000))).toBe(0n);
  });
});
