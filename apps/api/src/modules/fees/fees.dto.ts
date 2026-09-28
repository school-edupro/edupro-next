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
  miscView: 'fees.misc.view',
  reconcileView: 'payments.reconcile.view',
  reconcileRun: 'payments.reconcile.run',
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

export const SetProfileSchema = z.object({
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
    reason: z.string().trim().min(3).max(300),
  })
  .refine(
    (v) =>
      v.feeGroup !== undefined ||
      v.studentType !== undefined ||
      v.discountId !== undefined ||
      v.hosteller !== undefined ||
      v.transportSlabId !== undefined ||
      v.transportDisabled !== undefined,
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
