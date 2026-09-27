import { describe, expect, it } from 'vitest';
import {
  collapseStructures,
  feeDiscountStep,
  feeHeadStep,
  feePeriodStep,
  feeStructureStep,
  type FeeStructureRecord,
} from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

describe('fees domain transforms (Sprint 8)', () => {
  it('classifies heads by type and name', () => {
    expect(
      ok(
        feeHeadStep.transform({
          FeeHeadId: 'TUI',
          FeeHead: 'Tuition Fee',
          HeadType: 'Regular',
          Optional: 'N',
          SortOrder: '1',
        }),
      ).row,
    ).toMatchObject({
      code: 'TUI',
      name: 'Tuition Fee',
      kind: 'regular',
      isOptional: false,
      sortOrder: 1,
    });
    expect(ok(feeHeadStep.transform({ FeeHeadId: '13', FeeHead: 'Bus Fee' })).row.kind).toBe(
      'transport',
    );
    expect(
      ok(feeHeadStep.transform({ FeeHeadId: 'OPB', FeeHead: 'Previous Balance' })).row.kind,
    ).toBe('opening_balance');
    expect(Array.isArray(feeHeadStep.transform({ FeeHead: '' }))).toBe(true);
  });

  it('maps fees_master rows and collapses months into frequencies', () => {
    const raw = [
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
      'January',
      'February',
      'March',
    ].map((Month) => ({
      class: 'VI',
      feeshead: 'TUI',
      amount: '2,500',
      Month,
      StudentType: 'All',
      FeesType: 'General',
      FinancialYear: '2025-2026',
    }));
    const rows = raw.map((r) => ok(feeStructureStep.transform(r)).row);
    expect(rows[0]).toMatchObject({
      classCode: 'VI',
      headCode: 'TUI',
      amount: '2500.00',
      month: 4,
      studentType: 'all',
      feeGroup: 'general',
      legacyYear: '2025-26',
    });
    const quarterly = ['April', 'July', 'October', 'January'].map(
      (Month) =>
        ok(
          feeStructureStep.transform({
            class: 'VI',
            feeshead: 'DEV',
            amount: 1200,
            Month,
            StudentType: 'New',
          }),
        ).row,
    );
    const annual = [
      ok(feeStructureStep.transform({ class: 'VI', feeshead: 'ANN', amount: 3500, Month: 'April' }))
        .row,
    ];
    const collapsed = collapseStructures([
      ...rows,
      ...quarterly,
      ...annual,
    ] as FeeStructureRecord[]);
    expect(collapsed.find((s) => s.headCode === 'TUI')).toMatchObject({
      frequency: 'monthly',
      periods: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    expect(collapsed.find((s) => s.headCode === 'DEV')).toMatchObject({
      frequency: 'quarterly',
      studentType: 'new',
      periods: [1, 4, 7, 10],
    });
    expect(collapsed.find((s) => s.headCode === 'ANN')).toMatchObject({
      frequency: 'annual',
      periods: [1],
    });
    const rejected = feeStructureStep.transform({
      class: 'VI',
      feeshead: 'TUI',
      amount: 'abc',
      Month: 'April',
    });
    expect(Array.isArray(rejected)).toBe(true);
  });

  it('maps instalment months with due dates and discounts', () => {
    expect(
      ok(
        feePeriodStep.transform({
          Month: 'Apr',
          Quarter: 'Q1',
          FeesSubmissionLastDate: '10/04/2025',
          FinancialYear: '2025',
        }),
      ).row,
    ).toMatchObject({ month: 4, instalment: 1, dueOn: '2025-04-10' });
    expect(
      Array.isArray(
        feePeriodStep.transform({
          Month: 'Apr',
          Quarter: '',
          FeesSubmissionLastDate: '10/04/2025',
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        feeDiscountStep.transform({
          DiscountCode: 'SIB',
          DiscountName: 'Sibling',
          feeshead: 'TUI',
          DiscountType: 'Percent',
          DiscountValue: '50',
        }),
      ).row,
    ).toMatchObject({ code: 'SIB', headCode: 'TUI', percent: '50.00', amount: null });
    expect(
      ok(
        feeDiscountStep.transform({
          DiscountName: 'Staff Ward',
          feeshead: 'ALL',
          DiscountType: 'Fixed',
          DiscountValue: '1000',
          ApplyOnTransport: 'Y',
        }),
      ).row,
    ).toMatchObject({ headCode: null, percent: null, amount: '1000.00', appliesToTransport: true });
    expect(
      Array.isArray(
        feeDiscountStep.transform({
          DiscountCode: 'X',
          DiscountType: 'Percent',
          DiscountValue: '150',
        }),
      ),
    ).toBe(true);
  });
});
