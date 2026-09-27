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

export const DEFAULT_CLEARANCE_DEPARTMENTS = ['fees', 'library', 'transport', 'academics'];

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
export const RequestWithdrawalSchema = z.object({
  leavingOn: DateSchema,
  reason: z.string().trim().min(1).max(300),
  departments: z.array(z.string().trim().min(1).max(40)).min(1).max(10).optional(),
});
export class RequestWithdrawalDto extends createZodDto(RequestWithdrawalSchema) {}

export const ClearanceSchema = z.object({
  status: z.enum(['pending', 'cleared', 'hold']),
  dues: z.number().min(0).max(10_000_000).default(0),
  remarks: z.string().trim().max(300).optional(),
});
export class ClearanceDto extends createZodDto(ClearanceSchema) {}

export const ListWithdrawalsQuerySchema = z.object({
  status: z.enum(['requested', 'cleared', 'completed', 'cancelled', 'open']).default('open'),
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
