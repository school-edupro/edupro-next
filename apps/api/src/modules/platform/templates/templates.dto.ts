import { DOCUMENT_ENTITIES } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../../academics/classes/classes.dto';

export const TemplateKindSchema = z.enum(['transfer_certificate', 'bonafide', 'letter']);
const SizeSchema = z.string().regex(/^\d+(\.\d+)?(mm|cm|in)$/, 'must be a length such as 210mm');

export const CreateTemplateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'lower case, digits and underscore'),
  name: z.string().trim().min(1).max(120),
  kind: TemplateKindSchema,
  pageWidth: SizeSchema.default('210mm'),
  pageHeight: SizeSchema.default('297mm'),
  bodyHtml: z.string().min(1).max(200_000),
  stylesCss: z.string().max(50_000).default(''),
});
export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}

export const UpdateTemplateSchema = CreateTemplateSchema.omit({ code: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateTemplateDto extends createZodDto(UpdateTemplateSchema) {}

export const PreviewTemplateSchema = z.object({
  entity: z.enum(DOCUMENT_ENTITIES as [string, ...string[]]).optional(),
  entityId: IdSchema.optional(),
});
export class PreviewTemplateDto extends createZodDto(PreviewTemplateSchema) {}

export const RenderTemplateSchema = z.object({
  entity: z.enum(DOCUMENT_ENTITIES as [string, ...string[]]),
  entityId: IdSchema,
  title: z.string().trim().max(120).optional(),
});
export class RenderTemplateDto extends createZodDto(RenderTemplateSchema) {}

export const TEMPLATES = {
  view: 'platform.template.view',
  manage: 'platform.template.manage',
} as const;
