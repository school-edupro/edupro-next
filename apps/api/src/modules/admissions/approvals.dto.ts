import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DecideSchema } from './process.dto';

/** Admission approvers (docs/design/50). */
const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ApprovalsQuerySchema = z.object({
  tab: z.enum(['waiting', 'decided']).default('waiting'),
  size: z.coerce.number().int().min(1).max(2000).default(100),
  // filters (docs/design/51)
  cycleId: Id.optional(),
  classId: Id.optional(),
  categoryId: Id.optional(),
  status: z
    .string()
    .regex(/^[a-z_]{3,20}$/)
    .optional(),
  stage: z.string().trim().max(80).optional(),
  level: z.string().trim().max(120).optional(),
  q: z.string().trim().max(80).optional(),
  from: Day.optional(),
  to: Day.optional(),
  overdue: z.enum(['1']).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class ApprovalsQueryDto extends createZodDto(ApprovalsQuerySchema) {}

/** An approver's decision: the remark is required, whatever the decision. */
export const ApprovalDecideSchema = DecideSchema.omit({ categoryId: true }).extend({
  decision: z.enum(['approve', 'reject', 'hold']),
  remarks: z.string().trim().min(3, 'Write a remark (at least 3 letters)').max(1000),
});
export class ApprovalDecideDto extends createZodDto(ApprovalDecideSchema) {}

/** An approver's correction of the answers (docs/design/51): checked against the form, each change kept. */
export const ApprovalCorrectSchema = z.object({
  answers: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.unknown())
    .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 80, {
      message: 'Change between 1 and 80 answers at a time',
    }),
  reason: z.string().trim().min(3, 'Give the reason for the change').max(500),
});
export class ApprovalCorrectDto extends createZodDto(ApprovalCorrectSchema) {}

/** An upload slot for a document or photo the approver puts in place of the family's. */
export const ApprovalDocumentSlotSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});
export class ApprovalDocumentSlotDto extends createZodDto(ApprovalDocumentSlotSchema) {}

/** The uploaded file takes the family's place, with the reason. */
export const ApprovalDocumentSchema = z.object({
  fileId: z.string().regex(/^\d{1,18}$/),
  reason: z.string().trim().min(3, 'Give the reason for the change').max(500),
});
export class ApprovalDocumentDto extends createZodDto(ApprovalDocumentSchema) {}
