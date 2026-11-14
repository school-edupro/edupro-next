import { describe, expect, it } from 'vitest';
import { NEVER_READ, payrollTables, payrollUrlFromEnv } from '../src/processors/legacy-payroll';

describe('the old payroll module reader (docs/design/86, phase G)', () => {
  it('takes the connection from the environment: payroll’s own, else the leave cut-over’s', () => {
    expect(payrollUrlFromEnv('AB1', {})).toBeNull();
    expect(payrollUrlFromEnv('AB1', { LEGACY_LEAVE_DB_URL: 'mysql://erp' })).toBe('mysql://erp');
    expect(
      payrollUrlFromEnv('AB1', {
        LEGACY_LEAVE_DB_URL: 'mysql://erp',
        LEGACY_PAYROLL_DB_URL: 'mysql://pay',
      }),
    ).toBe('mysql://pay');
    expect(
      payrollUrlFromEnv('ab-1', {
        LEGACY_PAYROLL_DB_URL: 'mysql://pay',
        LEGACY_PAYROLL_DB_URL_AB_1: 'mysql://own',
      }),
    ).toBe('mysql://own');
  });

  it('reads plain payroll tables, never the encrypted PAN and bank copies', () => {
    for (const t of payrollTables()) expect(t.tbl).toMatch(/^payroll_[a-z_]+$/);
    expect(payrollTables().map((t) => t.tbl)).toContain('payroll_salary_record_line');
    expect(NEVER_READ).toEqual(expect.arrayContaining(['PanEnc', 'BankAccountEnc']));
  });
});
