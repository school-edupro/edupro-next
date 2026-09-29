import { describe, expect, it } from 'vitest';
import { isValidCron, nextCronRun, parseCron } from '../src/cron';

/** Sprint 19: the five-field cron used by scheduled reports, evaluated in IST. */
describe('cron', () => {
  it('parses lists, ranges and steps', () => {
    const p = parseCron('0,30 7-9 * * 1-5');
    expect([...p.minutes]).toEqual([0, 30]);
    expect([...p.hours]).toEqual([7, 8, 9]);
    expect([...p.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('*/15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
  });

  it('rejects malformed expressions', () => {
    expect(isValidCron('0 7 * *')).toBe(false);
    expect(isValidCron('60 7 * * *')).toBe(false);
    expect(isValidCron('0 25 * * *')).toBe(false);
    expect(isValidCron('a b c d e')).toBe(false);
    expect(isValidCron('0 7 * * 1')).toBe(true);
  });

  it('finds the next Monday 07:00 IST after a Sunday evening', () => {
    // 2026-09-27 is a Sunday; 18:00 IST = 12:30Z
    const from = new Date('2026-09-27T12:30:00Z');
    const next = nextCronRun('0 7 * * 1', from);
    // Monday 2026-09-28 07:00 IST = 01:30Z
    expect(next?.toISOString()).toBe('2026-09-28T01:30:00.000Z');
  });

  it('fires later the same day when the slot is still ahead, and never on the same minute as `from`', () => {
    // 07:00 IST → 07:30 IST the same day
    expect(nextCronRun('30 7 * * *', new Date('2026-09-28T01:30:00Z'))?.toISOString()).toBe(
      '2026-09-28T02:00:00.000Z',
    );
    // exactly 07:30 IST → tomorrow
    expect(nextCronRun('30 7 * * *', new Date('2026-09-28T02:00:00Z'))?.toISOString()).toBe(
      '2026-09-29T02:00:00.000Z',
    );
  });

  it('honours day-of-month', () => {
    const next = nextCronRun('0 9 1 * *', new Date('2026-09-15T00:00:00Z'));
    expect(next?.toISOString()).toBe('2026-10-01T03:30:00.000Z');
  });
});
