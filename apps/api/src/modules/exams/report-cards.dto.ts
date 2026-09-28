import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const REPORT_CARDS = {
  view: 'exams.report_card.view',
  manage: 'exams.report_card.manage',
  familyView: 'exams.family.view',
} as const;

export const BandSchema = z.enum(['primary', 'middle', 'secondary', 'senior']);
const SizeSchema = z.string().regex(/^\d+(\.\d+)?(mm|cm|in)$/);

const SectionSchema = z.object({
  type: z.enum([
    'header',
    'student',
    'scholastic',
    'co_scholastic',
    'attendance',
    'health',
    'remarks',
    'result',
    'grade_scale',
    'signatures',
  ]),
  title: z.string().trim().max(80).optional(),
  showGrades: z.boolean().optional(),
  showTotals: z.boolean().optional(),
  showRank: z.boolean().optional(),
  showPhoto: z.boolean().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
});
export const LayoutSchema = z.object({
  sections: z.array(SectionSchema).min(1).max(12),
  subtitle: z.string().trim().max(80).optional(),
});

export const CreateTemplateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(120),
  band: BandSchema,
  layout: LayoutSchema.optional(),
  bodyHtml: z.string().max(200_000).nullable().optional(),
  stylesCss: z.string().max(50_000).default(''),
  pageWidth: SizeSchema.default('210mm'),
  pageHeight: SizeSchema.default('297mm'),
});
export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}

export const UpdateTemplateSchema = CreateTemplateSchema.omit({ code: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateTemplateDto extends createZodDto(UpdateTemplateSchema) {}

export const PreviewSchema = z.object({
  studentId: IdSchema.optional(),
  releaseId: IdSchema.optional(),
  band: BandSchema.optional(),
});
export class PreviewDto extends createZodDto(PreviewSchema) {}

export const CreateReleaseSchema = z.object({
  termCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{1,12}$/),
  name: z.string().trim().min(2).max(120),
  examIds: z.array(IdSchema).min(1).max(12),
  /** template id per band; a band without one uses the active template of that band */
  templates: z.record(BandSchema, IdSchema).default({}),
  hideDefaulters: z.boolean().default(false),
  defaulterMin: z.coerce.number().min(0).default(0),
});
export class CreateReleaseDto extends createZodDto(CreateReleaseSchema) {}

export const UpdateReleaseSchema = CreateReleaseSchema.omit({ termCode: true })
  .extend({ status: z.enum(['draft', 'released', 'withdrawn']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateReleaseDto extends createZodDto(UpdateReleaseSchema) {}

export const RenderBatchSchema = z.object({ classSectionId: IdSchema });
export class RenderBatchDto extends createZodDto(RenderBatchSchema) {}
