import { describe, expect, it } from 'vitest';
import {
  feeReceiptLineStep,
  feeReceiptStep,
  feeReceiptTotalsByYear,
  normaliseMode,
  reconcileFeeReceiptYear,
  type FeeReceiptLineRecord,
  type FeeReceiptRecord,
} from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

const header = (over: Record<string, unknown> = {}) => ({
  receipt: 'tf1042',
  sadmission: 'a2401',
  sname: 'Aarav Sharma',
  sclass: 'VI-A',
  fees_amount: '7300',
  ReceiptDate: '20-04-2025',
  PaymentMode: 'Cheque',
  ChequeNo: '004512',
  BankName: 'SBI',
  ChequeDate: '18-04-2025',
  FinancialYear: '2025-26',
  ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  ReceiptNo: 'TF1042',
  TutionFee: '6000',
  TransportFee: '0',
  AnnualCharges: '1200',
  ActualLateFee: '150',
  AdjustedLateFee: '100',
  PreviousBalance: '0',
  PaidBalanceAmt: '0',
  CurrentBalance: '0',
  Discount: '0',
  ...over,
});

describe('fees + fees_transaction → receipts (Sprint 13)', () => {
  it('maps the header with the number kept verbatim, the mode and the instrument', () => {
    const r = ok(feeReceiptStep.transform(header()));
    expect(r.legacyKey).toBe('TF1042');
    expect(r.row).toMatchObject({
      receiptNo: 'TF1042',
      admissionNo: 'A2401',
      receivedOn: '2025-04-20',
      amount: '7300.00',
      mode: 'cheque',
      instrumentNo: '004512',
      instrumentDate: '2025-04-18',
      bankName: 'SBI',
      cancelled: false,
      legacyYear: '2025-26',
    });
  });

  it('rejects a missing number, a non-positive amount and an unknown mode', () => {
    expect(feeReceiptStep.transform(header({ receipt: '' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'fee_receipt.number_missing', blocking: true }),
      ]),
    );
    expect(feeReceiptStep.transform(header({ fees_amount: '0' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'fee_receipt.amount_invalid' })]),
    );
    expect(feeReceiptStep.transform(header({ PaymentMode: 'Barter' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'fee_receipt.mode_unknown', column: 'PaymentMode' }),
      ]),
    );
    expect(normaliseMode('NEFT')).toBe('bank');
    expect(normaliseMode(undefined)).toBe('cash');
  });

  it('maps the line with the charged late fee and the total the header must equal', () => {
    const r = ok(feeReceiptLineStep.transform(line()));
    expect(r.row).toMatchObject({
      receiptNo: 'TF1042',
      lateFeeComputed: '150.00',
      lateFee: '100.00',
      total: '7300.00',
    });
    expect(ok(feeReceiptLineStep.transform(line({ Discount: '300' }))).row.total).toBe('7000.00');
  });

  it('totals per year, quarantines receipts without a line or with a different amount, and reconciles', () => {
    const headers: FeeReceiptRecord[] = [
      ok(feeReceiptStep.transform(header())).row,
      ok(
        feeReceiptStep.transform(
          header({
            receipt: 'TF1043',
            sadmission: 'A2402',
            fees_amount: '500',
            PaymentMode: 'Cash',
          }),
        ),
      ).row,
      ok(
        feeReceiptStep.transform(
          header({
            receipt: 'TF1044',
            sadmission: 'A2403',
            fees_amount: '999',
            PaymentMode: 'UPI',
          }),
        ),
      ).row,
      ok(
        feeReceiptStep.transform(
          header({
            receipt: 'TF1045',
            sadmission: 'A2401',
            fees_amount: '10',
            status: 'Cancelled',
          }),
        ),
      ).row,
    ];
    const lines: FeeReceiptLineRecord[] = [
      ok(feeReceiptLineStep.transform(line())).row,
      ok(
        feeReceiptLineStep.transform(
          line({
            ReceiptNo: 'TF1043',
            TutionFee: '500',
            AnnualCharges: '0',
            ActualLateFee: '0',
            AdjustedLateFee: '0',
          }),
        ),
      ).row,
      ok(
        feeReceiptLineStep.transform(
          line({
            ReceiptNo: 'TF1044',
            TutionFee: '900',
            AnnualCharges: '0',
            ActualLateFee: '0',
            AdjustedLateFee: '0',
          }),
        ),
      ).row,
    ];
    const totals = feeReceiptTotalsByYear(headers, lines);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({
      legacyYear: '2025-26',
      receipts: 2,
      students: 2,
      amount: '7800.00',
      lateFee: '100.00',
      quarantined: ['TF1044'],
    });
    expect(totals[0]!.byMode).toEqual([
      { mode: 'cash', receipts: 1, amount: '500.00' },
      { mode: 'cheque', receipts: 1, amount: '7300.00' },
    ]);
    const measures = reconcileFeeReceiptYear(
      { receipts: 3, amount: 8799, lateFee: 100 },
      totals[0]!,
    );
    expect(measures.find((m) => m.measure === 'fee_receipt.receipts')).toMatchObject({
      legacyValue: 3,
      targetValue: 3,
    });
    expect(measures.find((m) => m.measure === 'fee_receipt.quarantined')).toMatchObject({
      targetValue: 1,
    });
  });
});
