import { describe, expect, it } from 'vitest';
import {
  collapseGradeScales,
  examMasterStep,
  examSubjectStep,
  examTypeStep,
  gradeBandStep,
  hostelFeeReceiptStep,
  miscReceiptStep,
  type GradeBandRecord,
} from '../src';

const ok = <T>(r: T | unknown[]): T => {
  if (Array.isArray(r)) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r as T;
};

describe('exam masters (Sprint 14)', () => {
  it('maps exam types, exams per class with flags, and subjects with max marks and locks', () => {
    expect(
      ok(
        examTypeStep.transform({ exam_code: 'pt1', exam_name: 'Periodic Test 1', weightage: '10' }),
      ).row,
    ).toMatchObject({
      code: 'PT1',
      name: 'Periodic Test 1',
      weightage: '10.00',
      status: 'active',
    });
    const m = ok(
      examMasterStep.transform({
        exam_code: 'PT1',
        examtype: 'pt1',
        master_class: 'VI',
        ShowPortal: 'Yes',
        mark_upload: '0',
      }),
    );
    expect(m.legacyKey).toBe('PT1|VI');
    expect(m.row).toMatchObject({
      code: 'PT1',
      typeCode: 'PT1',
      classCode: 'VI',
      showOnPortal: true,
      marksLocked: true,
    });
    const s = ok(
      examSubjectStep.transform({
        exam_code: 'PT1',
        sclass: 'VI',
        subject_code: 'MAT',
        max_marks: '40',
        EntryLockStatus: '1',
        elective: 'N',
      }),
    );
    expect(s.row).toMatchObject({
      examCode: 'PT1',
      classCode: 'VI',
      subjectCode: 'MAT',
      maxMarks: '40.00',
      entryLocked: true,
      isElective: false,
    });
    expect(
      examSubjectStep.transform({
        exam_code: 'PT1',
        sclass: 'VI',
        subject_code: 'MAT',
        max_marks: '0',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'exam_subject.max_marks_invalid' }),
      ]),
    );
  });

  it('turns marks ranges into percentage bands and groups them into scales', () => {
    const rows: GradeBandRecord[] = [
      ok(
        gradeBandStep.transform({
          MasterClass: 'VI-VIII',
          MaxMarks: '100',
          RangeFrom: '91',
          RangeTo: '100',
          Grade: 'A1',
          GradePoints: '10',
        }),
      ).row,
      ok(
        gradeBandStep.transform({
          MasterClass: 'VI-VIII',
          MaxMarks: '100',
          RangeFrom: '81',
          RangeTo: '90',
          Grade: 'A2',
          GradePoints: '9',
        }),
      ).row,
      ok(
        gradeBandStep.transform({
          MasterClass: 'I-V',
          MaxMarks: '50',
          RangeFrom: '45',
          RangeTo: '50',
          Grade: 'A',
        }),
      ).row,
    ];
    expect(rows[0]).toMatchObject({
      scaleCode: 'LEGACY_VI_VIII',
      minPct: 91,
      maxPct: 100,
      grade: 'A1',
      points: 10,
    });
    expect(rows[2]).toMatchObject({
      scaleCode: 'LEGACY_I_V',
      minPct: 90,
      maxPct: 100,
      grade: 'A',
      points: null,
    });
    const scales = collapseGradeScales(rows);
    expect(scales.map((s) => s.code)).toEqual(['LEGACY_I_V', 'LEGACY_VI_VIII']);
    expect(scales[1]!.bands.map((b) => b.grade)).toEqual(['A1', 'A2']);
    expect(
      gradeBandStep.transform({ MasterClass: 'X', RangeFrom: '50', RangeTo: '40', Grade: 'B' }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'grade.range_inverted' })]),
    );
  });

  it('reads the hostel mirror and misc collections with the fee receipt rules', () => {
    expect(hostelFeeReceiptStep.legacyTable).toBe('hostel_fees');
    const h = ok(
      hostelFeeReceiptStep.transform({
        receipt: 'HF/22',
        sadmission: 'A1',
        fees_amount: '3000',
        ReceiptDate: '2025-05-02',
        PaymentMode: 'Cash',
      }),
    );
    expect(h.row).toMatchObject({ receiptNo: 'HF/22', amount: '3000.00', mode: 'cash' });
    const m = ok(
      miscReceiptStep.transform({
        receipt_no: 'MF/7',
        receipt_date: '2025-06-01',
        emp_code: 'e015',
        head: 'ID Card',
        amount: '150',
        payment_mode: 'UPI',
        txn_id: 'U1',
      }),
    );
    expect(m.row).toMatchObject({
      receiptNo: 'MF/7',
      payerKind: 'employee',
      employeeCode: 'E015',
      headCode: 'ID_CARD',
      amount: '150.00',
      mode: 'upi',
      reference: 'U1',
    });
    expect(
      ok(
        miscReceiptStep.transform({
          receipt_no: 'MF/8',
          receipt_date: '2025-06-01',
          payer_name: 'Acme Books',
          head: 'Stall',
          amount: '5000',
        }),
      ).row.payerKind,
    ).toBe('vendor');
    expect(
      miscReceiptStep.transform({
        receipt_no: '',
        receipt_date: '2025-06-01',
        head: 'X',
        amount: '1',
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'misc_receipt.number_missing' })]),
    );
  });
});
