import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** Mark schemes (docs/design/65, part 3): the definition the engine in packages/db works out. */
const Rounding = z.enum(['none', 'two', 'whole', 'half_kept', 'up']);
const Key = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{0,11}$/, 'capital letters and digits, up to 12');
const Treatment = z.enum(['zero', 'exclude', 'fixed', 'percent', 'pro_rata']);

export const SchemeColumnSchema = z.object({
  key: Key,
  label: z.string().trim().min(1).max(40),
  kind: z.enum(['raw', 'average', 'sum', 'convert', 'attendance']),
  exam: Key.optional(),
  part: z.string().trim().max(60).optional(),
  wholeIfNoParts: z.boolean().optional(),
  of: z.array(Key).max(12).optional(),
  best: z.number().int().min(1).max(10).optional(),
  scale: z.union([z.number().positive().max(1000), z.literal('rest')]).optional(),
  round: Rounding.optional(),
  hidden: z.boolean().optional(),
  total: z.boolean().optional(),
  target: z.number().positive().max(1000).optional(),
  passGroup: z.enum(['theory', 'practical']).optional(),
});

export const SchemeDefSchema = z.object({
  exams: z
    .array(z.object({ key: Key, examId: IdSchema }))
    .min(1)
    .max(20),
  columns: z.array(SchemeColumnSchema).min(1).max(40),
  codes: z.record(z.string().trim().toUpperCase().max(12), Treatment).optional(),
  attendance: z
    .array(z.object({ minPct: z.number().min(0).max(100), marks: z.number().min(0).max(100) }))
    .max(10)
    .optional(),
  result: z.object({
    passPct: z.number().min(0).max(100).default(33),
    partsEach: z.boolean().optional(),
    compartmentUpTo: z.number().int().min(0).max(5).default(2),
    divisions: z
      .array(
        z.object({ name: z.string().trim().min(1).max(30), minPct: z.number().min(0).max(100) }),
      )
      .max(6)
      .optional(),
    rankBy: z.enum(['total', 'pct']).default('total'),
    countAdditional: z.boolean().optional(),
    totalRound: Rounding.optional(),
  }),
  gradeScaleId: IdSchema.nullable().optional(),
});

const TermCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{1,12}$/, 'capital letters and digits, e.g. T1');

export const CreateSchemeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    purpose: z.enum(['result', 'register']),
    termCode: TermCode.optional(),
    classIds: z.array(IdSchema).min(1).max(30),
    /** a ready-made scheme and which exam of the year each of its keys is */
    preset: z.string().trim().max(40).optional(),
    examMap: z.record(z.string().trim().toUpperCase().max(12), IdSchema).optional(),
    def: SchemeDefSchema.optional(),
  })
  .refine((x) => Boolean(x.def) !== Boolean(x.preset), {
    message: 'Start from a ready-made scheme or give the columns',
    path: ['preset'],
  })
  .refine((x) => x.purpose === 'register' || Boolean(x.termCode), {
    message: 'A result scheme needs its term (T1, T2 ...)',
    path: ['termCode'],
  });
export class CreateSchemeDto extends createZodDto(CreateSchemeSchema) {}

export const UpdateSchemeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    termCode: TermCode.nullable(),
    classIds: z.array(IdSchema).min(1).max(30),
    def: SchemeDefSchema,
  })
  .partial();
export class UpdateSchemeDto extends createZodDto(UpdateSchemeSchema) {}

export const RegisterQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  classId: IdSchema.optional(),
  view: z.enum(['marks', 'merit']).default('marks'),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
export class RegisterQueryDto extends createZodDto(RegisterQuerySchema) {}
