import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  /** filter[field]=value pairs arrive flattened by the query parser as `filters` */
  filters: z.record(z.string().max(40), z.string().max(120)).optional(),
});
export class RowsQueryDto extends createZodDto(RowsQuerySchema) {}

export const UploadSchema = z
  .object({
    fileName: z.string().trim().max(200).optional(),
    /** CSV text (small files) ... */
    csv: z.string().max(2_000_000).optional(),
    /** ... or an .xlsx file, base64 (4 MB limit checked after decoding) */
    contentBase64: z.string().max(6_000_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'Send either csv or contentBase64',
  });
export class UploadDto extends createZodDto(UploadSchema) {}

export const SaveRowSchema = z.object({
  id: z.string().regex(/^\d+$/).optional(),
  values: z.record(z.string().max(40), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export class SaveRowDto extends createZodDto(SaveRowSchema) {}

export const SetStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export class SetStatusDto extends createZodDto(SetStatusSchema) {}

export const BulkUpdateSchema = z.object({
  ids: z.array(z.string().regex(/^\d+$/)).min(1).max(1000),
  field: z.string().max(40),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export class BulkUpdateDto extends createZodDto(BulkUpdateSchema) {}

export const CloneSchema = z.object({
  fromYearId: z.string().regex(/^\d+$/),
  toYearId: z.string().regex(/^\d+$/),
});
export class CloneDto extends createZodDto(CloneSchema) {}
