import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RULE_OPS } from '@edupro/db';
import { IdSchema } from '../academics/classes/classes.dto';

/** docs/design/48: a row of a merit score table (the fields of its table). */
const Score = z.number().min(-1000).max(1000);
export const ScoreRowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fatherScore: Score.optional(),
  motherScore: Score.optional(),
  fatherWeight: Score.optional(),
  motherWeight: Score.optional(),
  classId: IdSchema.nullable().optional(),
  band: z.string().trim().max(40).nullable().optional(),
  area: z.string().trim().max(40).nullable().optional(),
  passoutClass: z.string().trim().max(40).optional(),
  score: Score.optional(),
});
export class ScoreRowDto extends createZodDto(ScoreRowSchema) {}

export const ScoreImportSchema = z.object({ fileBase64: z.string().min(100).max(1_400_000) });
export class ScoreImportDto extends createZodDto(ScoreImportSchema) {}

export const RecalculateSchema = z.object({ classId: IdSchema.optional() });
export class RecalculateDto extends createZodDto(RecalculateSchema) {}

export const ScoreReportQuerySchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  categoryId: IdSchema.optional(),
  status: z
    .string()
    .regex(/^[a-z_]{3,20}$/)
    .optional(),
  /** only registrations with a line the office should look at */
  check: z.enum(['1']).optional(),
});
export class ScoreReportQueryDto extends createZodDto(ScoreReportQuerySchema) {}

/** A number series (docs/design/48, part 5). */
export const NumberSeriesSchema = z.object({
  kind: z.enum(['registration', 'admission']),
  cycleId: IdSchema,
  classId: IdSchema.nullable().optional(),
  name: z.string().trim().min(2).max(80),
  conditions: z
    .array(
      z.object({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
        op: z.enum(RULE_OPS),
        value: z.string().max(200).optional(),
      }),
    )
    .max(5)
    .default([]),
  prefix: z
    .string()
    .trim()
    .max(30)
    .regex(/^[^\s]*$/, 'no spaces in the prefix'),
  nextNo: z.number().int().min(0).max(9_999_999_999),
  digits: z.number().int().min(1).max(10),
});
export class NumberSeriesDto extends createZodDto(NumberSeriesSchema) {}
