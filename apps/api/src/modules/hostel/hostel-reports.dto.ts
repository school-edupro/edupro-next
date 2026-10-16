import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const HOSTEL_REPORTS = ['register', 'occupancy', 'withdrawals', 'leave'] as const;
export type HostelReportId = (typeof HOSTEL_REPORTS)[number];
export const HostelReportIdSchema = z.enum(HOSTEL_REPORTS);

/** The filters of the hostel reports; each report reads the ones it has. */
export const HostelReportQuerySchema = z.object({
  hostelId: IdSchema.optional(),
  /** register: stays covering from-to; withdrawals: leaving from-to */
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  /** register: open / ended / all stays */
  open: z.enum(['open', 'ended', 'all']).optional(),
  /** withdrawals */
  status: z
    .enum(['requested', 'cleared', 'completed', 'cancelled', 'rejected', 'open', 'all'])
    .optional(),
  /** withdrawals: only those whose approval waits for me */
  mine: z.coerce.boolean().optional(),
  /** leave and outings */
  show: z.enum(['out', 'overdue', 'handover', 'pending', 'all']).optional(),
  q: z.string().trim().max(60).optional(),
});
export class HostelReportQueryDto extends createZodDto(HostelReportQuerySchema) {}

export const HostelReportFileSchema = HostelReportQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class HostelReportFileDto extends createZodDto(HostelReportFileSchema) {}

export const HostelReportColumnsSchema = z.object({
  hidden: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(60),
  scope: z.enum(['user', 'school']).default('user'),
});
export class HostelReportColumnsDto extends createZodDto(HostelReportColumnsSchema) {}
