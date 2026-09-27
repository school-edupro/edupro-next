import { describe, expect, it } from 'vitest';
import {
  feeDemandStep,
  feeDemandTotalsByYear,
  reconcileFeeDemandYear,
  type FeeDemandRecord,
} from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

const row = (over: Record<string, unknown> = {}) => ({
  sadmission: 'a2401',
  feeshead: 'TUI',
  head_original_amount: '2500',
  head_concession_amount: '1250',
  amount: '1250',
  quarter: 'Q1',
  Month: 'April',
  StudentType: 'Old',
  FeesType: 'General',
  InputSource: 'GenerateFee',
  FinancialYear: '2025-26',
  ...over,
});

describe('fees_student → fee_demands (Sprint 12)', () => {
  it('maps a legacy demand row with gross, concession, net, sequence and instalment', () => {
    const r = ok(feeDemandStep.transform(row()));
    expect(r.legacyKey).toBe('A2401|TUI|4|2025-26');
    expect(r.legacyYear).toBe('2025-26');
    expect(r.row).toMatchObject({
      admissionNo: 'A2401',
      headCode: 'TUI',
      gross: '2500.00',
      discount: '1250.00',
      net: '1250.00',
      sequence: 1,
      instalment: 1,
      studentType: 'old',
      feeGroup: 'general',
      source: 'generatefee',
    });
    expect(ok(feeDemandStep.transform(row({ Month: 'March' }))).row.sequence).toBe(12);
    expect(ok(feeDemandStep.transform(row({ Month: 'January' }))).row.sequence).toBe(10);
  });

  it('rejects missing admission, month or year and a net that disagrees with the legacy amount', () => {
    expect(Array.isArray(feeDemandStep.transform(row({ sadmission: '' })))).toBe(true);
    expect(Array.isArray(feeDemandStep.transform(row({ Month: '' })))).toBe(true);
    expect(Array.isArray(feeDemandStep.transform(row({ FinancialYear: '' })))).toBe(true);
    const bad = feeDemandStep.transform(row({ amount: '1000' }));
    expect(Array.isArray(bad)).toBe(true);
    expect((bad as Array<{ reason: string }>)[0]!.reason).toBe('fee_demand.net_mismatch');
  });

  it('totals per year and per head and reconciles against legacy sums', () => {
    const rows: FeeDemandRecord[] = [
      ok(feeDemandStep.transform(row())).row,
      ok(feeDemandStep.transform(row({ Month: 'May' }))).row,
      ok(
        feeDemandStep.transform(
          row({
            feeshead: 'DEV',
            head_original_amount: '1000',
            head_concession_amount: '0',
            amount: '1000',
          }),
        ),
      ).row,
      ok(
        feeDemandStep.transform(
          row({
            sadmission: 'A2402',
            FinancialYear: '2026-27',
            head_concession_amount: '0',
            amount: '2500',
          }),
        ),
      ).row,
    ];
    const totals = feeDemandTotalsByYear(rows);
    expect(totals.map((t) => t.legacyYear)).toEqual(['2025-26', '2026-27']);
    expect(totals[0]).toMatchObject({
      rows: 3,
      students: 1,
      gross: '6000.00',
      discount: '2500.00',
      net: '3500.00',
    });
    expect(totals[0]!.byHead).toEqual([
      { headCode: 'DEV', rows: 1, net: '1000.00' },
      { headCode: 'TUI', rows: 2, net: '2500.00' },
    ]);
    const measures = reconcileFeeDemandYear({ rows: 3, net: 3500, students: 1 }, totals[0]!);
    expect(measures.every((m) => m.legacyValue === m.targetValue)).toBe(true);
    const off = reconcileFeeDemandYear({ rows: 3, net: 3600, students: 1 }, totals[0]!);
    expect(off.find((m) => m.measure === 'fee_demand.net')!.legacyValue).not.toBe(
      off.find((m) => m.measure === 'fee_demand.net')!.targetValue,
    );
  });
});
