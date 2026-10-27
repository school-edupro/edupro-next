import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** Where the results are: a session, a class and a Test or Interview stage (docs/design/57). */
const PlaceSchema = z.object({ cycleId: IdSchema, classId: IdSchema, stageId: IdSchema });

export const ResultsQuerySchema = PlaceSchema.extend({
  slotId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** a percentage band: "0-10", "11-20" … "91-100" */
  band: z
    .string()
    .regex(/^\d{1,3}-\d{1,3}$/)
    .optional(),
  cutoff: z.enum(['below', 'ok']).optional(),
  state: z.enum(['waiting', 'decided', 'unmarked']).optional(),
});
export class ResultsQueryDto extends createZodDto(ResultsQuerySchema) {}

export const ResultsExportSchema = ResultsQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class ResultsExportDto extends createZodDto(ResultsExportSchema) {}

export const ResultsSheetSchema = PlaceSchema;
export class ResultsSheetDto extends createZodDto(ResultsSheetSchema) {}

export const ResultsUploadQuerySchema = z.object({ apply: z.enum(['0', '1']).optional() });
export class ResultsUploadQueryDto extends createZodDto(ResultsUploadQuerySchema) {}

/** Rows saved from the screen: every part's marks (null: none), absent, remark, a decision. */
export const ResultsSaveSchema = PlaceSchema.extend({
  rows: z
    .array(
      z.object({
        applicationId: IdSchema,
        marks: z.record(IdSchema, z.number().min(0).max(1000).nullable()),
        absent: z.boolean().optional(),
        remark: z.string().trim().max(500).nullable().optional(),
        decision: z.enum(['select', 'hold']).nullable().optional(),
        /** a candidate already decided at the stage: why the marks change */
        reason: z.string().trim().min(3).max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export class ResultsSaveDto extends createZodDto(ResultsSaveSchema) {}
