import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SHADOW_CLOSE = 'fees.shadow.close';
export const SHADOW = {
  view: 'fees.shadow.view',
  manage: 'fees.shadow.manage',
  serviceKeys: 'platform.service_key.manage',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * A legacy feed: the legacy tables' own rows. `receipts` carries `fees` headers (with their
 * `fees_transaction` lines under `lines` or as a flat `lines` array keyed by ReceiptNo); `balances` carries
 * `fees_student`-derived balances per admission number as of a date. Rows may also arrive as CSV text.
 */
export const FeedSchema = z
  .object({
    kind: z.enum(['receipts', 'balances']),
    source: z.string().trim().min(2).max(80),
    fileName: z.string().trim().max(160).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
    lines: z.array(z.record(z.string(), z.unknown())).max(20000).optional(),
    csv: z.string().max(4_000_000).optional(),
  })
  .refine((v) => (v.rows && v.rows.length > 0) || (v.csv && v.csv.length > 0), {
    message: 'rows or csv is required',
  });
export class FeedDto extends createZodDto(FeedSchema) {}

export const ReconcileSchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class ReconcileDto extends createZodDto(ReconcileSchema) {}

export const VariancesQuerySchema = z.object({
  runId: z.string().regex(/^\d+$/).optional(),
  status: z.enum(['open', 'explained', 'resolved']).optional(),
  kind: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(100),
});
export class VariancesQueryDto extends createZodDto(VariancesQuerySchema) {}

export const DecideVarianceSchema = z.object({
  status: z.enum(['explained', 'resolved', 'open']),
  explanation: z.string().trim().max(600).optional(),
});
export class DecideVarianceDto extends createZodDto(DecideVarianceSchema) {}

export const CreateServiceKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z
    .array(z.enum(['shadow.feed', 'transport.gps']))
    .min(1)
    .max(5),
});
export class CreateServiceKeyDto extends createZodDto(CreateServiceKeySchema) {}

// ---- Sprint 19: closing the shadow run (M3) ----
export const CloseShadowSchema = z.object({
  /** when the last runs are not all zero, an override needs a reason */
  reason: z.string().trim().max(500).optional(),
});
export class CloseShadowDto extends createZodDto(CloseShadowSchema) {}
