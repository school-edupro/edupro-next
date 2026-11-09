import { describe, expect, it } from 'vitest';
import { fyStartOf, legacyTables, legacyUrlFromEnv } from '../src/processors/legacy-leave';

describe('the old leave module reader (docs/design/85, phase E)', () => {
  it('takes the connection from the environment, a school’s own first', () => {
    expect(legacyUrlFromEnv('AB1', {})).toBeNull();
    expect(legacyUrlFromEnv('AB1', { LEGACY_LEAVE_DB_URL: 'mysql://all' })).toBe('mysql://all');
    expect(
      legacyUrlFromEnv('ab-1', {
        LEGACY_LEAVE_DB_URL: 'mysql://all',
        LEGACY_LEAVE_DB_URL_AB_1: 'mysql://own',
      }),
    ).toBe('mysql://own');
  });

  it('reads the set-up whole and the history from the financial year', () => {
    expect(fyStartOf('2026-11-09')).toBe('2026-04-01');
    expect(fyStartOf('2027-02-01')).toBe('2026-04-01');
    const t = legacyTables('2026-04-01');
    const by = Object.fromEntries(t.map((x) => [x.tbl, x]));
    expect(by.al_leave_type!.args).toEqual([]);
    expect(by.al_attendance_daily!.args).toEqual(['2026-04-01']);
    expect(by.al_leave_balance!.args).toEqual([202604]);
    expect(by.al_leave_request!.where).toContain('ToDate');
    // only plain table names reach the query
    for (const x of t) expect(x.tbl).toMatch(/^al_[a-z_]+$/);
  });
});
