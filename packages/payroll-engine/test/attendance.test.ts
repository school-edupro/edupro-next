import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  daysString,
  deriveAttendance,
  payWindow,
  type RegisterDay,
} from '../src/attendance';

const june = (days: Record<string, RegisterDay>) =>
  new Map(Object.entries(days).map(([d, v]) => [`2026-06-${d}`, v]));
const base = {
  from: '2026-06-01',
  to: '2026-06-30',
  today: '2026-07-10',
  unmarkedAs: 'present' as const,
};

describe('payWindow', () => {
  it('is the calendar month, or the cycle from a day of the month before', () => {
    expect(payWindow('2026-06-01')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(payWindow('2026-02-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(payWindow('2026-06-01', 26)).toEqual({ from: '2026-05-26', to: '2026-06-25' });
    expect(payWindow('2026-01-01', 21)).toEqual({ from: '2025-12-21', to: '2026-01-20' });
  });
});

describe('datesBetween and daysString', () => {
  it('lists each day and prints hundredths', () => {
    expect(datesBetween('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(daysString(2950n)).toBe('29.50');
    expect(daysString(5n)).toBe('0.05');
    expect(daysString(-150n)).toBe('-1.50');
  });
});

describe('deriveAttendance', () => {
  it('a full month with every kind of day', () => {
    const days: Record<string, RegisterDay> = {};
    for (let d = 1; d <= 30; d += 1) days[String(d).padStart(2, '0')] = { type: 'P' };
    days['07'] = { type: 'WO' };
    days['14'] = { type: 'H' };
    days['02'] = { type: 'A' };
    days['03'] = { type: 'HD' };
    days['04'] = { type: 'LV', portion: 100, leaveCode: 'CL' };
    days['05'] = { type: 'LV', portion: 50, leaveCode: 'CL' };
    days['08'] = { type: 'LV', portion: 100, leaveCode: 'LOP', lossOfPay: true };
    days['09'] = { type: 'LV', portion: 100, leaveCode: 'HPL', payPercent: 50 };
    days['10'] = { type: 'LV', portion: 50, leaveCode: 'HPL', payPercent: 50 };
    days['11'] = { type: 'HOLD' };
    days['12'] = { type: 'LV', leaveCode: 'EL', payPercent: null };
    days['13'] = { type: 'LV' };
    const f = deriveAttendance({ ...base, days: june(days) });
    expect(f.monthDays).toBe(3000n);
    // absent 1 + half day 0.5 + LOP leave 1 + half-pay 0.5 + 0.25 + hold 1
    expect(f.lop).toBe(425n);
    expect(f.detail.lopBreakdown).toEqual({
      absent: 100n,
      halfDay: 50n,
      lossOfPayLeave: 100n,
      partPayLeave: 75n,
      hold: 100n,
      unmarked: 0n,
    });
    // CL 1 + 0.5, HPL 0.5 + 0.25, EL 1, LV 1
    expect(f.paidLeave).toBe(425n);
    expect(f.detail.leave.CL).toEqual({ days: 150n, paid: 150n, lop: 0n });
    expect(f.detail.leave.HPL).toEqual({ days: 150n, paid: 75n, lop: 75n });
    expect(f.detail.leave.LV).toEqual({ days: 100n, paid: 100n, lop: 0n });
    // the worked halves of the half-day leaves and the half day count present
    expect(f.present).toBe(1800n + 50n + 50n + 50n);
    expect(f.paid).toBe(3000n - 425n);
    expect(f.unmarked).toBe(0);
    expect(f.detail.warnings).toEqual([]);
    expect(f.detail.counts.WO).toBe(100n);
  });

  it('unmarked past days count present or absent; days to come are paid with a warning', () => {
    const marked = june({ '01': { type: 'P' } });
    const p = deriveAttendance({ ...base, today: '2026-06-20', days: marked });
    expect(p.unmarked).toBe(19);
    expect(p.detail.futureDays).toBe(10);
    expect(p.lop).toBe(0n);
    expect(p.paid).toBe(3000n);
    expect(p.detail.warnings).toEqual([
      '19 past day(s) had nothing marked in the register: counted present',
      '10 day(s) are still to come: counted paid',
    ]);
    const a = deriveAttendance({ ...base, unmarkedAs: 'absent', days: marked });
    expect(a.lop).toBe(2900n);
    expect(a.detail.lopBreakdown.unmarked).toBe(2900n);
    expect(a.paid).toBe(100n);
  });

  it('days before joining and after leaving are neither paid nor loss of pay', () => {
    const joiner = deriveAttendance({ ...base, joinedOn: '2026-06-11', days: june({}) });
    expect(joiner.preJoin).toBe(1000n);
    expect(joiner.unmarked).toBe(20);
    expect(joiner.paid).toBe(2000n);
    const leaver = deriveAttendance({
      ...base,
      leftOn: '2026-06-20',
      unmarkedAs: 'absent',
      days: june({}),
    });
    expect(leaver.postLeave).toBe(1000n);
    expect(leaver.lop).toBe(2000n);
    expect(leaver.paid).toBe(0n);
  });

  it('a joiner after the month is paid nothing', () => {
    const f = deriveAttendance({ ...base, joinedOn: '2026-07-05', days: june({}) });
    expect(f.preJoin).toBe(3000n);
    expect(f.paid).toBe(0n);
    expect(f.detail.warnings).toContain('Not employed on any day of this month: nothing is paid');
  });

  it('never more loss of pay than the days employed', () => {
    const f = deriveAttendance({
      from: '2026-06-01',
      to: '2026-06-02',
      today: '2026-07-01',
      unmarkedAs: 'present',
      joinedOn: '2026-06-02',
      leftOn: '2026-06-01',
      days: june({}),
    });
    // the 1st is before joining, the 2nd after leaving: nothing employed
    expect(f.lop).toBe(0n);
    expect(f.paid).toBe(0n);
  });

  it('a day absent is the whole month unpaid when the month is one day', () => {
    const f = deriveAttendance({
      from: '2026-06-01',
      to: '2026-06-01',
      today: '2026-07-01',
      unmarkedAs: 'present',
      days: june({ '01': { type: 'A' } }),
    });
    expect(f.lop).toBe(100n);
    expect(f.paid).toBe(0n);
  });
});
