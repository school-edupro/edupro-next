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

/** A register (docs/design/68): per subject, its own chain of columns. */
const Token = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_~-]{1,32}$/, 'letters, digits, _ ~ -, up to 32');
const Pct = z.number().min(0).max(100);
const Dec = z.union([z.literal('auto'), z.literal(0), z.literal(1), z.literal(2)]);
export const RegColumnSchema = z.object({
  key: Token,
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['raw', 'part', 'avg', 'conv', 'attendance']),
  exam: Key.optional(),
  part: z.string().trim().max(60).optional(),
  wholeIfNoParts: z.boolean().optional(),
  group: Token.optional(),
  groupLabel: z.string().trim().max(60).optional(),
  groupFoot: z.enum(['sum', 'avg', 'both']).optional(),
  mode: z.enum(['all', 'best', 'sum']).optional(),
  best: z.number().int().min(1).max(10).optional(),
  agg: z.enum(['avg', 'sum']).optional(),
  of: z.array(Token).max(20).optional(),
  source: Token.optional(),
  method: z.enum(['scale', 'weight']).optional(),
  target: z.union([z.number().positive().max(1000), z.literal('rest')]).optional(),
  slabs: z
    .array(z.object({ minPct: Pct, marks: z.number().min(0).max(100) }))
    .max(10)
    .optional(),
  inTotal: z.boolean().optional(),
  hidden: z.boolean().optional(),
  round: z.boolean().optional(),
  grade: z.boolean().optional(),
  showCode: z.boolean().optional(),
  subFrom: z.string().trim().max(32).optional(),
  memberExam: z.record(IdSchema, Key.nullable()).optional(),
  memberTarget: z.record(IdSchema, z.number().positive().max(1000)).optional(),
});
export const RegSubjectSchema = z.object({
  key: Token,
  subjectId: IdSchema.optional(),
  slot: z
    .object({
      name: z.string().trim().min(1).max(40),
      members: z.array(IdSchema).min(2).max(12),
      breakup: z.boolean().optional(),
    })
    .optional(),
  columns: z.array(RegColumnSchema).max(40),
  showTotal: z.boolean().optional(),
  totalOutOf: z.number().positive().max(1000).nullable().optional(),
  round: z.enum(['none', 'keep', 'up']).optional(),
  grade: z.boolean().optional(),
  pct: z.boolean().optional(),
  countInFinal: z.boolean().optional(),
  childInColumns: z.boolean().optional(),
  childOrder: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  totalLabel: z.string().trim().max(40).optional(),
});
const RegCodeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(12),
  meaning: z.string().trim().max(60),
  treat: z.enum(['zero', 'excl', 'fixed', 'pctmax', 'prorata']),
  amt: z.number().min(0).max(1000).nullable().optional(),
  blocks: z.boolean(),
  showValue: z.boolean(),
  prPct: z.number().min(0).max(100).nullable().optional(),
});
export const RegisterDefSchema = z.object({
  v: z.literal(2),
  layout: z.enum(['header', 'vertical']),
  type: z.enum(['general', 'examwise']),
  order: z.enum(['roll', 'alpha', 'rank']),
  exams: z
    .array(z.object({ key: Key, examId: IdSchema }))
    .min(1)
    .max(20),
  subjects: z.array(RegSubjectSchema).min(1).max(40),
  ownOrder: z.boolean().optional(),
  codes: z.record(Key, z.array(RegCodeSchema).max(20)),
  final: z.object({
    total: z.boolean(),
    pct: z.boolean(),
    grade: z.boolean(),
    rank: z.boolean(),
    rankBy: z.enum(['total', 'pct']),
    round: z.enum(['none', 'keep', 'up']),
    result: z.boolean(),
    optionalMode: z.enum(['choices', 'register']),
    optionalInFinal: z.boolean(),
    optionalBlocks: z.boolean(),
    passPct: Pct,
    compartmentUpTo: z.number().int().min(0).max(5),
    partsEach: z.boolean(),
  }),
  grades: z
    .array(z.object({ grade: z.string().trim().min(1).max(10), minPct: Pct }))
    .min(1)
    .max(15),
  divisions: z.array(z.object({ name: z.string().trim().min(1).max(30), minPct: Pct })).max(6),
  display: z.object({
    showMax: z.boolean(),
    studentCols: z
      .array(z.object({ key: z.enum(['sr', 'name', 'roll', 'adm']), show: z.boolean() }))
      .length(4),
    divisionLabel: z.boolean(),
    properCase: z.boolean(),
    blankNotTaken: z.boolean(),
    childMax: z.boolean(),
    averages: z.boolean(),
    decimals: z.union([z.literal('auto'), z.literal(1), z.literal(2)]),
    finalDecimals: Dec,
    pctDecimals: Dec,
  }),
  analysis: z.object({
    enabled: z.boolean(),
    bands: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(20),
          op: z.enum(['>=', '>']),
          fromPct: Pct,
        }),
      )
      .max(15),
    cumulative: z.array(z.object({ op: z.enum(['>=', '>']), pct: Pct })).max(10),
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
    def: z.union([RegisterDefSchema, SchemeDefSchema]).optional(),
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
    def: z.union([RegisterDefSchema, SchemeDefSchema]),
    purpose: z.enum(['result', 'register']),
  })
  .partial();
export class UpdateSchemeDto extends createZodDto(UpdateSchemeSchema) {}

const Flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
export const RegisterQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  /** a class: every section together, ranked across the class (the merit list) */
  classId: IdSchema.optional(),
  view: z.enum(['marks', 'merit', 'division']).default('marks'),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  /** an exam-wise register: the exam's key; Missing marks / Absent students: one exam (docs/design/78) */
  exam: Key.optional(),
  /** one subject's own sheet: its register key */
  subject: Token.optional(),
  /** a file of every section, a section a page (or a sheet) */
  all: Flag.optional(),
  /** the register, or one of its reports (docs/design/68, phase 2) */
  report: z
    .enum([
      'register',
      'summary',
      'analysis',
      'entry',
      'missing',
      'absent',
      'attendance',
      'toppers',
      'teacher',
      'risk',
      'failing',
      'compare',
    ])
    .default('register'),
  /** Toppers: the top N, 1–100; "all" (or empty) = everyone in the % range (docs/design/76) */
  top: z
    .union([z.literal('all'), z.literal(''), z.coerce.number().int().min(1).max(100)])
    .transform((v) => (v === 'all' || v === '' ? null : v))
    .default(3),
  /** Toppers: only students whose % (the final, or the subject's) is in this range */
  pctFrom: z.coerce.number().min(0).max(100).optional(),
  pctTo: z.coerce.number().min(0).max(100).optional(),
  /** Toppers: the same lists from the bottom */
  lowest: Flag.optional(),
  /** Failing students: the number of subjects failed, from – to (docs/design/77) */
  failFrom: z.coerce.number().int().min(1).max(10).optional(),
  failTo: z.coerce.number().int().min(1).max(10).optional(),
  /** Attendance: the dates counted (docs/design/79; none: the session's first day, today) */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .optional(),
  /** At-risk: how far above the pass % is borderline */
  margin: z.coerce
    .number()
    .int()
    .refine((n) => [5, 10].includes(n), '5 or 10')
    .default(5),
  paper: z.enum(['A4', 'A3', 'Legal', 'Letter']).default('Legal'),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fit: Flag.default(true),
});
export class RegisterQueryDto extends createZodDto(RegisterQuerySchema) {}

export const CopySchemeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  classIds: z.array(IdSchema).min(1).max(30),
});
export class CopySchemeDto extends createZodDto(CopySchemeSchema) {}

export const RestoreSchemeSchema = z.object({
  /** a new name, when the old one is taken now */
  name: z.string().trim().min(2).max(120).optional(),
});
export class RestoreSchemeDto extends createZodDto(RestoreSchemeSchema) {}

export const SchemeAccessSchema = z.object({
  rows: z
    .array(
      z.object({
        userId: IdSchema,
        run: z.boolean(),
        edit: z.boolean(),
        delete: z.boolean(),
        assign: z.boolean(),
      }),
    )
    .max(400),
});
export class SchemeAccessDto extends createZodDto(SchemeAccessSchema) {}

export const RemoveAccessSchema = z.object({
  pairs: z
    .array(z.object({ chainId: IdSchema, userId: IdSchema }))
    .min(1)
    .max(500),
});
export class RemoveAccessDto extends createZodDto(RemoveAccessSchema) {}

export const BuilderQuerySchema = z.object({
  /** the classes, comma separated */
  classIds: z
    .string()
    .regex(/^\d{1,18}(,\d{1,18}){0,29}$/, 'class ids, comma separated')
    .transform((v) => v.split(',')),
});
export class BuilderQueryDto extends createZodDto(BuilderQuerySchema) {}
