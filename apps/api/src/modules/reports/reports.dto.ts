import { DATASET_IDS, RENDERER_IDS } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ExportFormatSchema = z.enum(['xlsx', 'csv', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const CreateExportSchema = z.object({
  dataset: z.enum([...DATASET_IDS, ...RENDERER_IDS] as [string, ...string[]]),
  format: ExportFormatSchema.default('xlsx'),
  params: z.record(z.string(), z.unknown()).default({}),
  title: z.string().trim().min(2).max(120).optional(),
});
export class CreateExportDto extends createZodDto(CreateExportSchema) {}

export const ListExportsQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']).optional(),
  /** Defaults to the caller's own exports. */
  mine: z.enum(['true', 'false']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListExportsQueryDto extends createZodDto(ListExportsQuerySchema) {}
