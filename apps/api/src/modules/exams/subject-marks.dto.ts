import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** The subject marks master (docs/design/70): an exam type's subjects and marks for a class. */
export const SubjectMarksQuerySchema = z.object({ typeId: IdSchema, classId: IdSchema });
export class SubjectMarksQueryDto extends createZodDto(SubjectMarksQuerySchema) {}

const Marks = z.number().min(0).max(1000);
export const SaveSubjectMarksSchema = z.object({
  typeId: IdSchema,
  classId: IdSchema,
  rows: z
    .array(
      z.object({
        subjectId: IdSchema,
        max: Marks,
        pass: Marks.nullable(),
        scaleId: IdSchema.nullable(),
        optional: z.boolean(),
        /** a part of its subject (the subject above it in the subject master), not a paper of its own */
        isPart: z.boolean().default(false),
      }),
    )
    .max(60),
});
export class SaveSubjectMarksDto extends createZodDto(SaveSubjectMarksSchema) {}

export const CopySubjectMarksSchema = z
  .object({
    typeId: IdSchema,
    classId: IdSchema,
    /** the same exam type for other classes (the subjects each studies) */
    toClassIds: z.array(IdSchema).max(40).default([]),
    /** other exam types for the same class */
    toTypeIds: z.array(IdSchema).max(40).default([]),
  })
  .refine((v) => v.toClassIds.length + v.toTypeIds.length > 0, {
    message: 'Choose the classes or the exam types to copy to',
    path: ['toClassIds'],
  });
export class CopySubjectMarksDto extends createZodDto(CopySubjectMarksSchema) {}

export const FillSubjectMarksSchema = z.object({ examId: IdSchema });
export class FillSubjectMarksDto extends createZodDto(FillSubjectMarksSchema) {}

export const LastYearSubjectMarksSchema = z.object({ typeId: IdSchema.optional() });
export class LastYearSubjectMarksDto extends createZodDto(LastYearSubjectMarksSchema) {}

export const SubjectMarksFileSchema = z.object({
  typeId: IdSchema,
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class SubjectMarksFileDto extends createZodDto(SubjectMarksFileSchema) {}
