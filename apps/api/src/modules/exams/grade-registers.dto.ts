import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** Grade registers (docs/design/69): the register's definition as the builder saves it. */
const AreaKey = z.string().max(80);
export const GradeDefSchema = z.object({
  v: z.literal(1),
  exams: z
    .array(z.object({ examId: IdSchema, label: z.string().trim().max(20) }))
    .min(1, 'Choose at least one assessment')
    .max(12),
  exAreas: z.array(AreaKey).max(200),
  exLeaves: z.array(IdSchema).max(3000),
  labels: z.record(z.string().regex(/^\d{1,18}$/), z.string().trim().max(60)),
  order: z.object({
    areas: z.array(AreaKey).max(200),
    items: z.record(AreaKey, z.array(IdSchema).max(1000)),
    leaves: z.record(z.string().regex(/^\d{1,18}$/), z.array(IdSchema).max(1000)),
  }),
  orderBy: z.enum(['roll', 'alpha']),
  descHeader: z.enum(['full', 'number']),
  showLegend: z.boolean(),
  properCase: z.boolean(),
  blankText: z.string().max(5),
  overall: z.enum(['off', 'mode', 'points']),
  scale: z
    .array(
      z.object({
        g: z.string().trim().min(1).max(12),
        p: z.number().min(-1000).max(1000).nullable(),
      }),
    )
    .max(15),
  studentCols: z
    .array(z.object({ key: z.enum(['sr', 'name', 'roll', 'adm']), show: z.boolean() }))
    .length(4),
});

const Name = z.string().trim().min(2).max(150);
export const CreateGradeRegisterSchema = z.object({
  name: Name,
  classIds: z.array(IdSchema).min(1).max(30),
  def: GradeDefSchema,
});
export class CreateGradeRegisterDto extends createZodDto(CreateGradeRegisterSchema) {}
export const UpdateGradeRegisterSchema = CreateGradeRegisterSchema.partial();
export class UpdateGradeRegisterDto extends createZodDto(UpdateGradeRegisterSchema) {}

export const CopyGradeRegisterSchema = z.object({
  name: Name,
  classIds: z.array(IdSchema).min(1).max(30),
});
export class CopyGradeRegisterDto extends createZodDto(CopyGradeRegisterSchema) {}
export const RestoreGradeRegisterSchema = z.object({ name: Name.optional() });
export class RestoreGradeRegisterDto extends createZodDto(RestoreGradeRegisterSchema) {}

/** All (every indicator of the register) or As per mapping (a teacher: the areas given to them) */
export const AccessTypeSchema = z.object({ type: z.enum(['all', 'mapping']) });
export class AccessTypeDto extends createZodDto(AccessTypeSchema) {}

const Ids = z
  .string()
  .regex(/^\d{1,18}(,\d{1,18}){0,29}$/, 'ids, comma separated')
  .transform((v) => v.split(','));
export const GradeBuilderQuerySchema = z.object({
  classIds: Ids.optional(),
  examIds: Ids.optional(),
});
export class GradeBuilderQueryDto extends createZodDto(GradeBuilderQuerySchema) {}

const Flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
/** Run (docs/design/69, part 3): a section, the layout, a report, filters, a file */
export const GradeRunQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  layout: z.enum(['class', 'student']).default('class'),
  report: z.enum(['sheet', 'summary', 'analysis', 'analysis-all']).default('sheet'),
  /** the areas shown (their keys, joined by |); none given: every area */
  areas: z.string().max(4000).optional(),
  /** the items shown (ids, comma-separated); none given: every item */
  items: z
    .string()
    .regex(/^\d{1,18}(,\d{1,18}){0,999}$/)
    .optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  /** a file of every section */
  all: Flag.optional(),
  paper: z.enum(['A4', 'A3', 'Legal', 'Letter']).default('Legal'),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fit: Flag.default(true),
});
export class GradeRunQueryDto extends createZodDto(GradeRunQuerySchema) {}
