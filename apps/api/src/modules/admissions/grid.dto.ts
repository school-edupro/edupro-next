import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { StudentGridSchema } from '../people/people.dto';

/** The admissions list (docs/design/39, part 7): the people-list view with admission status tabs. */
export const AdmissionGridSchema = StudentGridSchema.omit({
  status: true,
  academicYearId: true,
}).extend({
  status: z
    .enum(['mine', 'in_progress', 'unfinished', 'admitted', 'closed', 'all'])
    .default('in_progress'),
  /** Admissions list: every registration, drafts too; Registrations (docs/design/47): submitted ones */
  scope: z.enum(['list', 'registrations']).default('list'),
  /** Waiting for me: a set-up manager may see every registration waiting, not only their levels' */
  includeAll: z.boolean().default(false),
});
export class AdmissionGridDto extends createZodDto(AdmissionGridSchema) {}
export const AdmissionGridExportSchema = AdmissionGridSchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  title: z.string().trim().max(120).optional(),
});
export class AdmissionGridExportDto extends createZodDto(AdmissionGridExportSchema) {}
