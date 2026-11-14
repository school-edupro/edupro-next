import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const CERTIFICATE = {
  view: 'certificate.register.view',
  issue: 'certificate.register.issue',
  cancel: 'certificate.register.cancel',
  /** issue although a check fails, with a reason (the principal); a fresh MFA sign-in */
  override: 'certificate.register.override',
  setup: 'certificate.setup.manage',
} as const;

const TypeCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'an upper-case type code');
/** the typed fields of a type (the TC's reason, working days, conduct …): text or a whole number */
const Fields = z
  .record(z.string().regex(/^[a-zA-Z]{2,30}$/), z.union([z.string().trim().max(500), z.number()]))
  .default({});

export const PreviewCertificateSchema = z.object({
  typeCode: TypeCode,
  studentId: IdSchema,
  issuedOn: DateSchema.optional(),
  purpose: z.string().trim().max(200).optional(),
  fields: Fields,
});
export class PreviewCertificateDto extends createZodDto(PreviewCertificateSchema) {}

export const IssueCertificateSchema = PreviewCertificateSchema.extend({
  /** the principal's reason to issue although a check fails */
  overrideReason: z.string().trim().min(10, 'at least 10 characters').max(300).optional(),
});
export class IssueCertificateDto extends createZodDto(IssueCertificateSchema) {}

export const ReasonSchema = z.object({
  reason: z.string().trim().min(3, 'at least 3 characters').max(300),
});
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const ListCertificatesQuerySchema = z.object({
  type: TypeCode.optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
  /** original only, duplicates only */
  copy: z.enum(['original', 'duplicate']).optional(),
  override: z.enum(['yes']).optional(),
  q: z.string().trim().max(80).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  year: z.string().trim().max(12).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListCertificatesQueryDto extends createZodDto(ListCertificatesQuerySchema) {}

export const CertificatesFileQuerySchema = ListCertificatesQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class CertificatesFileQueryDto extends createZodDto(CertificatesFileQuerySchema) {}

export const StudentSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });
export class StudentSearchQueryDto extends createZodDto(StudentSearchQuerySchema) {}
