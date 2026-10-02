import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const LIFECYCLE = {
  tcView: 'people.tc.view',
  tcIssue: 'people.tc.issue',
  withdrawalView: 'people.withdrawal.view',
  withdrawalManage: 'people.withdrawal.manage',
  withdrawalClear: 'people.withdrawal.clear',
  promotionView: 'people.promotion.view',
  promotionManage: 'people.promotion.manage',
} as const;

// ---- transfer certificates ----------------------------------------------------------------------
export const IssueTcSchema = z.object({
  reason: z.string().trim().min(1).max(300),
  issuedOn: DateSchema.optional(),
  conduct: z.string().trim().min(1).max(60).default('Good'),
  promotionStatus: z.string().trim().max(120).optional(),
  duesCleared: z.boolean().default(true),
  remarks: z.string().trim().max(500).optional(),
  templateId: IdSchema.optional(),
});
export class IssueTcDto extends createZodDto(IssueTcSchema) {}

export const CancelSchema = z.object({ reason: z.string().trim().min(1).max(300) });
export class CancelDto extends createZodDto(CancelSchema) {}

export const ListTcQuerySchema = z.object({
  status: z.enum(['issued', 'cancelled']).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListTcQueryDto extends createZodDto(ListTcQuerySchema) {}

// ---- withdrawals --------------------------------------------------------------------------------
const FileRef = z.object({ fileId: IdSchema });

export const RequestWithdrawalSchema = z
  .object({
    initiatedOn: DateSchema.optional(),
    leavingOn: DateSchema,
    reason: z.string().trim().min(1).max(300),
    remarks: z.string().trim().max(1000).optional(),
    documents: z.array(FileRef).max(5).default([]),
  })
  .refine((d) => !d.initiatedOn || d.initiatedOn <= d.leavingOn, {
    message: 'the leaving date cannot be before the date the withdrawal was started',
    path: ['leavingOn'],
  });
export class RequestWithdrawalDto extends createZodDto(RequestWithdrawalSchema) {}

export const BulkWithdrawalSchema = z
  .object({
    studentIds: z.array(IdSchema).min(1).max(500),
    initiatedOn: DateSchema.optional(),
    leavingOn: DateSchema,
    reason: z.string().trim().min(1).max(300),
    remarks: z.string().trim().max(1000).optional(),
  })
  .refine((d) => !d.initiatedOn || d.initiatedOn <= d.leavingOn, {
    message: 'the leaving date cannot be before the date the withdrawal was started',
    path: ['leavingOn'],
  });
export class BulkWithdrawalDto extends createZodDto(BulkWithdrawalSchema) {}

export const ClearanceSchema = z.object({
  status: z.enum(['pending', 'cleared', 'hold']),
  dues: z.number().min(0).max(10_000_000).default(0),
  remarks: z.string().trim().max(500).optional(),
  documents: z.array(FileRef).max(5).default([]),
});
export class ClearanceDto extends createZodDto(ClearanceSchema) {}

export const BypassSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class BypassDto extends createZodDto(BypassSchema) {}

export const BulkClearanceSchema = z.object({
  withdrawalIds: z.array(IdSchema).min(1).max(500),
  department: z.string().trim().min(1).max(40),
  status: z.enum(['cleared', 'hold']),
  remarks: z.string().trim().max(500).optional(),
  /** One document (e.g. the signed no-dues list) attached to every ticked student's clearance. */
  documents: z.array(FileRef).max(5).default([]),
});
export class BulkClearanceDto extends createZodDto(BulkClearanceSchema) {}

export const BulkTcSchema = z.object({
  withdrawalIds: z.array(IdSchema).min(1).max(500),
  issuedOn: DateSchema.optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  conduct: z.string().trim().min(1).max(60).default('Good'),
  promotionStatus: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export class BulkTcDto extends createZodDto(BulkTcSchema) {}

export const WithdrawalTcSchema = BulkTcSchema.omit({ withdrawalIds: true });
export class WithdrawalTcDto extends createZodDto(WithdrawalTcSchema) {}

const Approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('office') }),
  z.object({ kind: z.literal('class_teacher') }),
  z.object({ kind: z.literal('role'), roleId: IdSchema, name: z.string().max(80).optional() }),
  z.object({ kind: z.literal('user'), userId: IdSchema, name: z.string().max(80).optional() }),
]);
export const DepartmentSchema = z.object({
  id: IdSchema.optional(),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lower-case letters, digits and _'),
  name: z.string().trim().min(2).max(80),
  step: z.number().int().min(1).max(9),
  approvers: z.array(Approver).min(1).max(4),
  autoCheck: z.enum(['none', 'fees', 'library']).default('none'),
  autoClear: z.boolean().default(false),
  bypassAllowed: z.boolean().default(false),
  documentRequired: z.boolean().default(false),
  gatesTc: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const SaveDepartmentsSchema = z.object({
  departments: z.array(DepartmentSchema).min(1).max(15),
});
export class SaveDepartmentsDto extends createZodDto(SaveDepartmentsSchema) {}
export type DepartmentInput = z.infer<typeof DepartmentSchema>;

export const ListWithdrawalsQuerySchema = z.object({
  status: z.enum(['requested', 'cleared', 'completed', 'cancelled', 'open']).default('open'),
  /** Only the withdrawals whose current step waits for me. */
  mine: z.coerce.boolean().optional(),
  classSectionId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListWithdrawalsQueryDto extends createZodDto(ListWithdrawalsQuerySchema) {}

// ---- promotions ---------------------------------------------------------------------------------
export const DecisionSchema = z.enum(['promote', 'retain', 'transfer_out', 'graduate']);

export const ListPromotionsQuerySchema = z.object({
  fromYearId: IdSchema.optional(),
  toYearId: IdSchema.optional(),
  classId: IdSchema,
});
export class ListPromotionsQueryDto extends createZodDto(ListPromotionsQuerySchema) {}

export const SetPromotionsSchema = z.object({
  fromYearId: IdSchema.optional(),
  toYearId: IdSchema,
  decisions: z
    .array(
      z
        .object({
          studentId: IdSchema,
          decision: DecisionSchema,
          toClassSectionId: IdSchema.optional(),
          remarks: z.string().trim().max(200).optional(),
        })
        .refine((d) => !['promote', 'retain'].includes(d.decision) || d.toClassSectionId, {
          message: 'toClassSectionId is required to promote or retain',
          path: ['toClassSectionId'],
        }),
    )
    .min(1)
    .max(500),
});
export class SetPromotionsDto extends createZodDto(SetPromotionsSchema) {}

export const ApplyPromotionsSchema = z.object({
  fromYearId: IdSchema.optional(),
  toYearId: IdSchema,
  classId: IdSchema.optional(),
});
export class ApplyPromotionsDto extends createZodDto(ApplyPromotionsSchema) {}

export const YearSectionsQuerySchema = z.object({ yearId: IdSchema });
export class YearSectionsQueryDto extends createZodDto(YearSectionsQuerySchema) {}
