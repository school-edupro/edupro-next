import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { StudentGridSchema } from '../people/people.dto';

/** The admissions list (docs/design/39, part 7): the people-list view with admission status tabs. */
export const AdmissionGridSchema = StudentGridSchema.omit({
  status: true,
  academicYearId: true,
}).extend({
  status: z.enum(['in_progress', 'unfinished', 'admitted', 'closed', 'all']).default('in_progress'),
});
export class AdmissionGridDto extends createZodDto(AdmissionGridSchema) {}
export const AdmissionGridExportSchema = AdmissionGridSchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  title: z.string().trim().max(120).optional(),
});
export class AdmissionGridExportDto extends createZodDto(AdmissionGridExportSchema) {}
