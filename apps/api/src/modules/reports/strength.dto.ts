import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Ids = z
  .string()
  .regex(/^\d{1,18}(,\d{1,18}){0,199}$/, 'comma-separated ids')
  .transform((s) => s.split(','));
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const Base = z.object({
  report: z.enum(['classwise', 'category', 'discount', 'age']),
  academicYearId: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  classIds: Ids.optional(),
  sectionIds: Ids.optional(),
  groupBy: z.enum(['section', 'class', 'class_stream']).default('section'),
  includeLeft: Flag.optional(),
  showEmpty: Flag.optional(),
  asOn: DateSchema.optional(),
  discountId: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
});
const needs = <T extends z.ZodTypeAny>(s: T) =>
  s
    .refine((d: z.infer<typeof Base>) => d.report !== 'age' || Boolean(d.asOn), {
      message: 'Enter the as-on date for the age report',
      path: ['asOn'],
    })
    .refine((d: z.infer<typeof Base>) => d.report !== 'discount' || Boolean(d.discountId), {
      message: 'Choose the discount',
      path: ['discountId'],
    });

export const StrengthQuerySchema = needs(Base);
export class StrengthQueryDto extends createZodDto(StrengthQuerySchema) {}

export const StrengthStudentsQuerySchema = needs(
  Base.extend({
    column: z.string().min(1).max(80),
    classId: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    classSectionId: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    stream: z.string().max(60).optional(),
  }),
);
export class StrengthStudentsQueryDto extends createZodDto(StrengthStudentsQuerySchema) {}

export const StrengthExportSchema = needs(Base.extend({ format: z.enum(['xlsx', 'pdf']) }));
export class StrengthExportDto extends createZodDto(StrengthExportSchema) {}
