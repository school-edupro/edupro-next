/**
 * Sensitive fields masked in audit payloads (ADR-005 point 6, logging standard section 3).
 * Keys are compared case-insensitively after removing underscores, so `bank_account_no`, `bankAccountNo`
 * and `BankAccountNo` all match. Personal (non-sensitive) fields stay unmasked because audit needs them.
 */
export const GLOBAL_SENSITIVE_KEYS = [
  'password',
  'spassword',
  'otp',
  'token',
  'secret',
  'aadhaar',
  'aadhaarno',
  'aadharnumber',
  'pan',
  'panno',
  'bankaccount',
  'bankaccountno',
  'accountno',
  'ifsc',
  'salary',
  'ctc',
  'healthnotes',
  'diagnosis',
  'disability',
  'caste',
  'religion',
];

/** Additional keys per entity type (table name) when a generic word is sensitive only in that context. */
export const ENTITY_SENSITIVE_KEYS: Record<string, string[]> = {
  employees: ['pfno', 'uanno', 'esino', 'basic', 'grosspay', 'netpay'],
  guardians: ['income', 'occupationincome'],
  clinic_visits: ['notes', 'complaint', 'treatment'],
  payroll_records: ['gross', 'net', 'deductions', 'earnings'],
};

const normalise = (key: string): string => key.toLowerCase().replace(/[_\s-]/g, '');

export function isSensitiveKey(key: string, entityType?: string): boolean {
  const n = normalise(key);
  if (GLOBAL_SENSITIVE_KEYS.includes(n)) return true;
  const extra = entityType ? ENTITY_SENSITIVE_KEYS[entityType] : undefined;
  return extra ? extra.includes(n) : false;
}

/** Returns a copy with sensitive values replaced by "***" at every depth. Non-objects pass through. */
export function maskSensitive<T>(value: T, entityType?: string): T {
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, entityType)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k, entityType) ? '***' : maskSensitive(v, entityType);
  }
  return out as T;
}
