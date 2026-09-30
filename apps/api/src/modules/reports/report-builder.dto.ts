import { REPORT_FILTER_OPS } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');
const Key = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{2,60}$/, 'unknown field');

export const ReportSpecSchema = z.object({
  columns: z
    .array(
      z.object({
        key: Key,
        label: z.string().trim().max(80).nullable().optional(),
        width: z.number().int().min(4).max(80).nullable().optional(),
      }),
    )
    .min(1, 'choose at least one column')
    .max(250),
  filters: z
    .array(
      z.object({
        key: Key,
        op: z.enum(REPORT_FILTER_OPS as [string, ...string[]]),
        values: z.array(z.string().trim().max(120)).max(200).optional(),
      }),
    )
    .max(30)
    .default([]),
  sort: z
    .array(z.object({ key: Key, dir: z.enum(['asc', 'desc']).default('asc') }))
    .max(5)
    .default([]),
  options: z
    .object({
      paper: z.enum(['A4', 'A3']).default('A4'),
      orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
      academicYearId: Id.nullable().optional(),
      includeInactive: z.boolean().default(false),
    })
    .default({}),
});

export const SaveReportSchema = z.object({
  name: z.string().trim().min(3, 'at least 3 characters').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  spec: ReportSpecSchema,
});
export class SaveReportDto extends createZodDto(SaveReportSchema) {}

export const ShareReportSchema = z.object({
  shares: z
    .array(
      z
        .object({
          userId: Id.optional(),
          roleId: Id.optional(),
          canEdit: z.boolean().default(false),
        })
        .refine((s) => Boolean(s.userId) !== Boolean(s.roleId), {
          message: 'give a user or a role',
        }),
    )
    .max(100),
});
export class ShareReportDto extends createZodDto(ShareReportSchema) {}

export const PreviewReportSchema = z.object({
  spec: ReportSpecSchema,
  limit: z.number().int().min(1).max(500).default(50),
});
export class PreviewReportDto extends createZodDto(PreviewReportSchema) {}

export const ExportReportSchema = z.object({ format: z.enum(['xlsx', 'pdf']) });
export class ExportReportDto extends createZodDto(ExportReportSchema) {}

export const ShareOptionsQuerySchema = z.object({ q: z.string().trim().max(60).optional() });
export class ShareOptionsQueryDto extends createZodDto(ShareOptionsQuerySchema) {}
