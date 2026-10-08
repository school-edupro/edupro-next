import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Money = z.number().min(0).max(100_000_000);

export const FEES = {
  masterView: 'fees.master.view',
  masterManage: 'fees.master.manage',
  profileManage: 'fees.profile.manage',
  demandView: 'fees.demand.view',
  demandGenerate: 'fees.demand.generate',
  lateFeeManage: 'fees.late_fee.manage',
  ledgerView: 'fees.ledger.view',
  /** Sprint 13: a family reads its own children's ledgers */
  familyView: 'fees.family.view',
  /** Sprint 14 */
  adjustmentRequest: 'fees.adjustment.request',
  adjustmentApprove: 'fees.adjustment.approve',
  profileChangeRequest: 'fees.profile_change.request',
  miscPost: 'fees.misc.post',
  /** Sprint 15 */
  defaulterNotify: 'fees.defaulter.notify',
  miscView: 'fees.misc.view',
  reconcileView: 'payments.reconcile.view',
  reconcileRun: 'payments.reconcile.run',
  carryForward: 'fees.carry_forward.run',
  depositSlip: 'fees.deposit_slip.manage',
} as const;

export const HeadKindSchema = z.enum([
  'regular',
  'transport',
  'opening_balance',
  'late_fee',
  'misc',
]);
export const FrequencySchema = z.enum([
  'monthly',
  'quarterly',
  'half_yearly',
  'annual',
  'one_time',
]);

export const CreateHeadSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{2,20}$/, 'upper case code'),
  name: z.string().trim().min(1).max(80),
  kind: HeadKindSchema.default('regular'),
  ledger: z.enum(['school', 'hostel', 'misc', 'admission']).default('school'),
  isOptional: z.boolean().default(false),
  refundable: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  /** Heads sharing this name print as one line ("Composite fee"); empty = the head's own name. */
  printGroup: z.string().trim().max(80).nullable().optional(),
  taxCertificate: z.boolean().default(false),
});
export class CreateHeadDto extends createZodDto(CreateHeadSchema) {}

export const UpdateHeadSchema = CreateHeadSchema.omit({ code: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateHeadDto extends createZodDto(UpdateHeadSchema) {}

export const GeneratePeriodsSchema = z.object({
  /** Day of month the instalment falls due (legacy FeesSubmissionLastDate). */
  dueDay: z.number().int().min(1).max(28).default(10),
  /** Months per instalment: 1 monthly, 3 quarterly, 6 half-yearly, 12 annual. */
  monthsPerInstalment: z
    .union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)])
    .default(3),
});
export class GeneratePeriodsDto extends createZodDto(GeneratePeriodsSchema) {}

export const StructureEntrySchema = z.object({
  headId: IdSchema,
  amount: Money,
  frequency: FrequencySchema.default('monthly'),
  studentType: z.enum(['all', 'new', 'old']).default('all'),
  periods: z.array(z.number().int().min(1).max(12)).max(12).optional(),
});

export const SetStructureSchema = z.object({
  feeGroup: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,30}$/)
    .default('general'),
  entries: z.array(StructureEntrySchema).max(100),
});
export class SetStructureDto extends createZodDto(SetStructureSchema) {}

export const CreateSlabSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{1,20}$/),
    name: z.string().trim().min(1).max(80),
    distanceFromKm: z.number().min(0).max(500).optional(),
    distanceToKm: z.number().min(0).max(500).optional(),
    monthlyAmount: Money,
  })
  .refine(
    (v) =>
      v.distanceFromKm === undefined ||
      v.distanceToKm === undefined ||
      v.distanceToKm >= v.distanceFromKm,
    {
      message: 'distanceToKm must not be below distanceFromKm',
      path: ['distanceToKm'],
    },
  );
export class CreateSlabDto extends createZodDto(CreateSlabSchema) {}

export const CreateDiscountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{1,20}$/),
    name: z.string().trim().min(1).max(80),
    headId: IdSchema.optional(),
    percent: z.number().min(0).max(100).optional(),
    amount: Money.optional(),
    appliesToTransport: z.boolean().default(false),
  })
  .refine((v) => (v.percent === undefined) !== (v.amount === undefined), {
    message: 'give percent or amount, not both',
    path: ['percent'],
  });
export class CreateDiscountDto extends createZodDto(CreateDiscountSchema) {}

/** One discount of a pupil for a run of months (fee period sequence, 1 = first month of the year). */
export const StudentDiscountSchema = z
  .object({
    discountId: IdSchema,
    fromSeq: z.number().int().min(1).max(12).default(1),
    toSeq: z.number().int().min(1).max(12).default(12),
  })
  .refine((v) => v.fromSeq <= v.toSeq, {
    message: 'from month is after to month',
    path: ['toSeq'],
  });
export type StudentDiscountInput = z.infer<typeof StudentDiscountSchema>;

export const SetProfileSchema = z.object({
  /** The pupil's additional discounts; the whole list replaces what is there. */
  discounts: z.array(StudentDiscountSchema).max(10).optional(),
  feeGroup: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,30}$/)
    .default('general'),
  studentType: z.enum(['new', 'old']),
  transportSlabId: IdSchema.nullable().optional(),
  transportDisabled: z.boolean().default(false),
  discountId: IdSchema.nullable().optional(),
  openingBalance: z.number().min(-100_000_000).max(100_000_000).default(0),
  notes: z.string().trim().max(300).optional(),
  instalmentsOverride: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(12)])
    .nullable()
    .optional(),
  /** Sprint 14: hostel-ledger heads of the class structure apply to hostellers */
  hosteller: z.boolean().default(false),
});
export class SetProfileDto extends createZodDto(SetProfileSchema) {}

export const GenerateClassDemandSchema = z.object({ classId: IdSchema });
export class GenerateClassDemandDto extends createZodDto(GenerateClassDemandSchema) {}

export const ListDemandsQuerySchema = z.object({
  status: z.enum(['pending', 'partial', 'paid', 'waived', 'cancelled']).optional(),
});
export class ListDemandsQueryDto extends createZodDto(ListDemandsQuerySchema) {}

export const ClassSummaryQuerySchema = z.object({ classId: IdSchema });
export class ClassSummaryQueryDto extends createZodDto(ClassSummaryQuerySchema) {}

// ---- Sprint 12: ledger, late fee, receipts -------------------------------------------------------
export const LedgerQuerySchema = z.object({ asOf: DateSchema.optional() });
export class LedgerQueryDto extends createZodDto(LedgerQuerySchema) {}

export const SetLateFeeOverrideSchema = z.object({
  /** The instalment's anchor period (from the ledger row). */
  periodId: IdSchema,
  /** The instalment's ledger: the school and hostel rows of one period are overridden separately. */
  ledger: z.enum(['school', 'hostel']).default('school'),
  /** 0 waives the late fee. */
  amount: Money,
  reason: z.string().trim().min(3).max(300),
});
export class SetLateFeeOverrideDto extends createZodDto(SetLateFeeOverrideSchema) {}

export const SetPeriodLateFeeSchema = z.object({
  /** Slab mode: charged after the due date until the first slab date. */
  lateFeeAmount: Money.default(0),
  /** Up to three later slabs (legacy LastFee_date_1..3 with Late_fees_1..3). */
  slabs: z
    .array(z.object({ on: DateSchema, amount: Money }))
    .max(3)
    .default([]),
  /** Families see the instalment from this date; null = the school-wide days-before setting. */
  visibleFrom: DateSchema.nullable().optional(),
});
export class SetPeriodLateFeeDto extends createZodDto(SetPeriodLateFeeSchema) {}

export const SetReceiptSequenceSchema = z.object({
  ledger: z.enum(['school', 'hostel', 'misc', 'admission']),
  financialYearId: IdSchema,
  prefix: z.string().trim().min(1).max(24),
  width: z.number().int().min(1).max(12).default(6),
  startAt: z.number().int().min(1).max(10_000_000).default(1),
});
export class SetReceiptSequenceDto extends createZodDto(SetReceiptSequenceSchema) {}

export { DateSchema as FeeDateSchema };

// ---- Sprint 14: adjustments, profile changes, misc receipts, reconciliation --------------------------
export const RequestAdjustmentSchema = z
  .object({
    kind: z.enum(['waiver', 'reversal', 'bounce']),
    /** waiver: the demand row */
    demandId: IdSchema.optional(),
    /** reversal, bounce: the receipt */
    paymentId: IdSchema.optional(),
    /** waiver: amount waived (bounded by the row's balance); reversal and bounce use the receipt amount */
    amount: Money.optional(),
    /** bounce: the charge added to the demand; defaults to the school setting fees.bounce_charge */
    charge: Money.optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine(
    (v) =>
      v.kind === 'waiver'
        ? v.demandId !== undefined && v.amount !== undefined
        : v.paymentId !== undefined,
    {
      message: 'waiver needs demandId and amount; reversal and bounce need paymentId',
    },
  );
export class RequestAdjustmentDto extends createZodDto(RequestAdjustmentSchema) {}

export const DecideAdjustmentSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional(),
});
export class DecideAdjustmentDto extends createZodDto(DecideAdjustmentSchema) {}

export const ListAdjustmentsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  studentId: IdSchema.optional(),
  kind: z.enum(['waiver', 'reversal', 'bounce']).optional(),
});
export class ListAdjustmentsQueryDto extends createZodDto(ListAdjustmentsQuerySchema) {}

export const RequestProfileChangeSchema = z
  .object({
    feeGroup: z
      .string()
      .trim()
      .regex(/^[a-z_]{1,30}$/)
      .optional(),
    studentType: z.enum(['new', 'old']).optional(),
    discountId: IdSchema.nullable().optional(),
    hosteller: z.boolean().optional(),
    transportSlabId: IdSchema.nullable().optional(),
    transportDisabled: z.boolean().optional(),
    /** The pupil's additional discounts after approval (the whole list). */
    discounts: z.array(StudentDiscountSchema).max(10).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine(
    (v) =>
      v.feeGroup !== undefined ||
      v.studentType !== undefined ||
      v.discountId !== undefined ||
      v.hosteller !== undefined ||
      v.transportSlabId !== undefined ||
      v.transportDisabled !== undefined ||
      v.discounts !== undefined,
    { message: 'nothing to change' },
  );
export class RequestProfileChangeDto extends createZodDto(RequestProfileChangeSchema) {}

export const ListProfileChangesQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  studentId: IdSchema.optional(),
});
export class ListProfileChangesQueryDto extends createZodDto(ListProfileChangesQuerySchema) {}

export const PostMiscReceiptSchema = z
  .object({
    payerKind: z.enum(['student', 'employee', 'vendor', 'other']),
    studentId: IdSchema.optional(),
    employeeId: IdSchema.optional(),
    payerName: z.string().trim().max(120).optional(),
    payerMobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/)
      .optional(),
    headId: IdSchema,
    amount: z.number().min(1).max(10_000_000),
    receivedOn: DateSchema.optional(),
    mode: z.enum(['cash', 'cheque', 'dd', 'upi', 'bank', 'card']),
    reference: z.string().trim().max(80).optional(),
    instrumentNo: z.string().trim().max(40).optional(),
    bankName: z.string().trim().max(80).optional(),
    remarks: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) =>
      (v.payerKind === 'student' && v.studentId !== undefined) ||
      (v.payerKind === 'employee' && v.employeeId !== undefined) ||
      ((v.payerKind === 'vendor' || v.payerKind === 'other') && !!v.payerName),
    { message: 'name the student, the employee, or the payer' },
  );
export class PostMiscReceiptDto extends createZodDto(PostMiscReceiptSchema) {}

export const ListMiscReceiptsQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  payerKind: z.enum(['student', 'employee', 'vendor', 'other']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListMiscReceiptsQueryDto extends createZodDto(ListMiscReceiptsQuerySchema) {}

/** Sprint 14 close-out: the misc form finds an employee by name, code or mobile instead of typing an id. */
export const MiscEmployeeLookupQuerySchema = z.object({
  q: z.string().trim().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export class MiscEmployeeLookupQueryDto extends createZodDto(MiscEmployeeLookupQuerySchema) {}

/** Sprint 15: fee reminders from the reports centre. */
export const NotifyDefaultersSchema = z.object({
  studentIds: z.array(IdSchema).min(1).max(500),
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
  asOf: DateSchema.optional(),
});
export class NotifyDefaultersDto extends createZodDto(NotifyDefaultersSchema) {}

// ---- Fee set-up, second pass (0098): class rules and payment modes --------------------------------
export const SetClassRulesSchema = z.object({
  /** Cheque-bounce charge of this class; null = the school's. */
  bounceCharge: Money.nullable().optional(),
  /** How this class is charged late fee; null = as the school */
  lateMode: z.enum(['daywise', 'slab']).nullable().optional(),
  latePerDay: Money.nullable().optional(),
  /** day-wise: the most one instalment can be charged; null = no limit */
  lateMax: Money.nullable().optional(),
  periods: z
    .array(
      z.object({
        periodId: IdSchema,
        /** null = the school's last date */
        dueOn: DateSchema.nullable().optional(),
        /** null = the school's late fee and slabs */
        lateFeeAmount: Money.nullable().optional(),
        slabs: z
          .array(z.object({ on: DateSchema, amount: Money }))
          .max(3)
          .default([]),
        /** day-wise mode: rupees per day; null = the school's */
        latePerDay: Money.nullable().optional(),
        /** the class's own quarter number; null = the school's */
        instalment: z.number().int().min(1).max(12).nullable().optional(),
        /** parents see the instalment from this date */
        startOn: DateSchema.nullable().optional(),
        challanOn: DateSchema.nullable().optional(),
        bounceCharge: Money.nullable().optional(),
        /** parents may pay it online */
        feePay: z.boolean().optional(),
        /** parents see it at all */
        show: z.boolean().optional(),
      }),
    )
    .max(12)
    .default([]),
});
export class SetClassRulesDto extends createZodDto(SetClassRulesSchema) {}

export const PAYMENT_MODES = ['cash', 'cheque', 'dd', 'upi', 'card', 'bank', 'online'] as const;
export const SetPaymentModeSchema = z.object({
  label: z.string().trim().min(1).max(40),
  atCounter: z.boolean(),
  needReference: z.boolean().default(false),
  needInstrumentNo: z.boolean().default(false),
  needInstrumentDate: z.boolean().default(false),
  needBank: z.boolean().default(false),
});
export class SetPaymentModeDto extends createZodDto(SetPaymentModeSchema) {}

// ---- Year-end carry-forward (0099) -------------------------------------------------------------------
export const CarryPreviewQuerySchema = z.object({
  toYearId: IdSchema,
  /** The closing year; the working year when left out. */
  fromYearId: IdSchema.optional(),
});
export class CarryPreviewQueryDto extends createZodDto(CarryPreviewQuerySchema) {}

export const RunCarryForwardSchema = z.object({
  toYearId: IdSchema,
  fromYearId: IdSchema.optional(),
  /** Leave out to carry every pupil that can be carried. */
  studentIds: z.array(IdSchema).min(1).max(5000).optional(),
});
export class RunCarryForwardDto extends createZodDto(RunCarryForwardSchema) {}

export const UndoCarryForwardSchema = z.object({
  toYearId: IdSchema,
  fromYearId: IdSchema.optional(),
  studentId: IdSchema,
});
export class UndoCarryForwardDto extends createZodDto(UndoCarryForwardSchema) {}

// ---- Bank deposit slips (0100) ------------------------------------------------------------------------
export const PendingInstrumentsQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  ledger: z.enum(['school', 'hostel', 'misc', 'admission']).optional(),
});
export class PendingInstrumentsQueryDto extends createZodDto(PendingInstrumentsQuerySchema) {}

export const CreateDepositSlipSchema = z.object({
  bankAccountId: IdSchema,
  depositOn: DateSchema,
  /** `p:<fee receipt id>` or `m:<misc receipt id>` */
  items: z
    .array(z.string().regex(/^[pm]:\d{1,18}$/))
    .min(1)
    .max(500),
  remarks: z.string().trim().max(200).optional(),
});
export class CreateDepositSlipDto extends createZodDto(CreateDepositSlipSchema) {}

// ---- Printed fee papers: bill, tax certificate, provisional bill of a withdrawal ----------------------
export const BillQuerySchema = z.object({ upTo: DateSchema.optional() });
export class BillQueryDto extends createZodDto(BillQuerySchema) {}

export const ClassBillsQuerySchema = z
  .object({
    classId: IdSchema.optional(),
    sectionId: IdSchema.optional(),
    upTo: DateSchema.optional(),
  })
  .refine((v) => v.classId || v.sectionId, { message: 'choose a class or a section' });
export class ClassBillsQueryDto extends createZodDto(ClassBillsQuerySchema) {}

export const TaxCertificateQuerySchema = z.object({ financialYearId: IdSchema.optional() });
export class TaxCertificateQueryDto extends createZodDto(TaxCertificateQuerySchema) {}

export const MyTaxCertificateQuerySchema = z.object({
  studentId: IdSchema,
  financialYearId: IdSchema.optional(),
});
export class MyTaxCertificateQueryDto extends createZodDto(MyTaxCertificateQuerySchema) {}

export const FnfQuerySchema = z.object({
  lastSeq: z.coerce.number().int().min(1).max(12).optional(),
});
export class FnfQueryDto extends createZodDto(FnfQuerySchema) {}

// ---- Fee changes that wait for approval (0101) -----------------------------------------------------------
export const RequestChangeSchema = z
  .object({
    kind: z.enum(['late_fee', 'transfer', 'date_change']),
    /** late_fee: the pupil, by id or by admission number */
    studentId: IdSchema.optional(),
    admissionNo: z.string().trim().min(1).max(40).optional(),
    /** late_fee: the instalment's month, its ledger and the late fee to charge instead (0 waives it) */
    periodId: IdSchema.optional(),
    ledger: z.enum(['school', 'hostel']).optional(),
    amount: Money.optional(),
    /** transfer, date_change: the receipt as printed */
    receiptNo: z.string().trim().min(1).max(60).optional(),
    /** transfer: the pupil who should have got the money */
    toAdmissionNo: z.string().trim().min(1).max(40).optional(),
    /** date_change */
    newReceivedOn: DateSchema.optional(),
    newClearedOn: DateSchema.optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine(
    (v) =>
      v.kind === 'late_fee'
        ? (v.studentId !== undefined || v.admissionNo !== undefined) &&
          v.periodId !== undefined &&
          v.amount !== undefined
        : v.kind === 'transfer'
          ? v.receiptNo !== undefined && v.toAdmissionNo !== undefined
          : v.receiptNo !== undefined &&
            (v.newReceivedOn !== undefined || v.newClearedOn !== undefined),
    { message: 'the request is incomplete for its kind' },
  );
export class RequestChangeDto extends createZodDto(RequestChangeSchema) {}

export const DecideChangeSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional(),
});
export class DecideChangeDto extends createZodDto(DecideChangeSchema) {}

export const ListChangeRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  kind: z.enum(['late_fee', 'transfer', 'date_change']).optional(),
});
export class ListChangeRequestsQueryDto extends createZodDto(ListChangeRequestsQuerySchema) {}

const FileBase64 = z.string().min(20).max(4_000_000);
export const SettlementUploadSchema = z.object({
  fileBase64: FileBase64,
  reason: z.string().trim().min(3).max(300),
});
export class SettlementUploadDto extends createZodDto(SettlementUploadSchema) {}

export const CollectionUploadSchema = z.object({
  fileBase64: FileBase64,
  fileName: z.string().trim().max(200).optional(),
});
export class CollectionUploadDto extends createZodDto(CollectionUploadSchema) {}

export const CollectionSubmitSchema = z.object({
  action: z.enum(['submit', 'cancel']),
  reason: z.string().trim().max(300).optional(),
});
export class CollectionSubmitDto extends createZodDto(CollectionSubmitSchema) {}

export const CloneClassRulesSchema = z.object({ toClassIds: z.array(IdSchema).min(1).max(60) });
export class CloneClassRulesDto extends createZodDto(CloneClassRulesSchema) {}
