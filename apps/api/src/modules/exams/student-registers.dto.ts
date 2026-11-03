import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** The legacy Student Registers (docs/design/69): reports over what was entered, nothing saved. */
export const STUDENT_REGISTERS = ['remark', 'attendance', 'health'] as const;
export type StudentRegisterType = (typeof STUDENT_REGISTERS)[number];

const Flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const StudentRegisterQuerySchema = z.object({
  classId: IdSchema.optional(),
  /** one section, or every section of the class the person may open */
  section: z.union([IdSchema, z.literal('all')]).optional(),
  /** the exams picked (ids, comma-separated); they print in the exams' order */
  exams: z
    .string()
    .regex(/^\d{1,18}(,\d{1,18}){0,29}$/, 'exam ids, comma-separated')
    .optional(),
  /** Attendance: below this % is marked */
  cutoff: z.coerce.number().int().min(0).max(100).default(75),
  /** Height & Weight: the BMI columns */
  bmi: Flag.default(true),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  paper: z.enum(['A4', 'A3', 'Legal', 'Letter']).default('Legal'),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fit: Flag.default(true),
});
export class StudentRegisterQueryDto extends createZodDto(StudentRegisterQuerySchema) {}
