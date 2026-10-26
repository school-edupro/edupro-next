import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DecideSchema } from './process.dto';

/** Admission approvers (docs/design/50). */
export const ApprovalsQuerySchema = z.object({
  tab: z.enum(['waiting', 'decided']).default('waiting'),
  size: z.coerce.number().int().min(1).max(200).default(100),
});
export class ApprovalsQueryDto extends createZodDto(ApprovalsQuerySchema) {}

/** An approver's decision: the remark is required, whatever the decision. */
export const ApprovalDecideSchema = DecideSchema.extend({
  decision: z.enum(['approve', 'reject', 'hold']),
  remarks: z.string().trim().min(3, 'Write a remark (at least 3 letters)').max(1000),
});
export class ApprovalDecideDto extends createZodDto(ApprovalDecideSchema) {}
