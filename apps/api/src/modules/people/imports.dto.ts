import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ImportKindSchema = z.enum(['students', 'employees']);

export const ValidateImportSchema = z.object({
  kind: ImportKindSchema,
  fileName: z.string().trim().max(200).optional(),
  /** CSV text with a header row. 2 MB is roughly 10,000 student rows. */
  csv: z.string().min(1).max(2_000_000),
});
export class ValidateImportDto extends createZodDto(ValidateImportSchema) {}

export const ListImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export class ListImportsQueryDto extends createZodDto(ListImportsQuerySchema) {}

/** Columns accepted per import kind; the first group is mandatory. */
export const IMPORT_COLUMNS = {
  students: {
    required: ['admission_no', 'first_name'],
    optional: [
      'last_name',
      'dob',
      'gender',
      'category',
      'blood_group',
      'house',
      'admitted_on',
      'guardian_name',
      'guardian_mobile',
      'guardian_email',
      'guardian_relation',
      'section',
      'roll_no',
    ],
  },
  employees: {
    required: ['employee_code', 'first_name'],
    optional: [
      'last_name',
      'dob',
      'gender',
      'employee_type',
      'designation',
      'department',
      'joined_on',
      'mobile',
      'email',
    ],
  },
} as const;
