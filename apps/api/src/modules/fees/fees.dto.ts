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

export { DateSchema as FeeDateSchema };
