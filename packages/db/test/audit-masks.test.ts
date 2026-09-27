import { describe, expect, it } from 'vitest';
import { isSensitiveKey, maskSensitive } from '../src/audit-masks';

describe('audit masks', () => {
  it('matches sensitive keys regardless of case and separators', () => {
    expect(isSensitiveKey('bank_account_no')).toBe(true);
    expect(isSensitiveKey('BankAccountNo')).toBe(true);
    expect(isSensitiveKey('aadhaar')).toBe(true);
    expect(isSensitiveKey('name')).toBe(false);
    expect(isSensitiveKey('notes')).toBe(false);
    expect(isSensitiveKey('notes', 'clinic_visits')).toBe(true);
  });

  it('masks at every depth and leaves personal fields readable', () => {
    const masked = maskSensitive(
      {
        name: 'A',
        mobile: '9876543210',
        guardian: { name: 'B', pan_no: 'ABCDE1234F' },
        docs: [{ aadhaar: '1234' }],
      },
      'students',
    );
    expect(masked).toEqual({
      name: 'A',
      mobile: '9876543210',
      guardian: { name: 'B', pan_no: '***' },
      docs: [{ aadhaar: '***' }],
    });
  });

  it('passes scalars and null through', () => {
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive('x')).toBe('x');
  });
});
