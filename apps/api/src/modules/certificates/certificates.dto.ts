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

const PreviewBase = z.object({
  typeCode: TypeCode,
  /** a student type's student, or a staff type's employee */
  studentId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  /** another layout of the type (one of its variants) */
  variant: IdSchema.optional(),
  issuedOn: DateSchema.optional(),
  purpose: z.string().trim().max(200).optional(),
  fields: Fields,
});
const onePerson = (v: { studentId?: string; employeeId?: string }) =>
  !(v.studentId && v.employeeId);
export const PreviewCertificateSchema = PreviewBase.refine(onePerson, {
  message: 'a student or an employee, not both',
});
export class PreviewCertificateDto extends createZodDto(PreviewCertificateSchema) {}

export const IssueCertificateSchema = PreviewBase.extend({
  /** the principal's reason to issue although a check fails */
  overrideReason: z.string().trim().min(10, 'at least 10 characters').max(300).optional(),
}).refine(onePerson, { message: 'a student or an employee, not both' });
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

// ---- set-up (phase B) ----------------------------------------------------------------------------------------------
const FieldSpecSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z]{1,29}$/, 'letters only, starting small (e.g. eventName)'),
  label: z.string().trim().min(2).max(120),
  kind: z.enum(['text', 'date', 'number', 'list']),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  hint: z.string().trim().max(160).optional(),
});
const RulesSchema = z.object({
  state: z.enum(['active', 'leaving', 'any']),
  fees: z.boolean().optional(),
  library: z.boolean().optional(),
  hostel: z.boolean().optional(),
  transport: z.boolean().optional(),
  classes: z.array(z.string().trim().min(1).max(12)).max(20).optional(),
});
export const UpdateTypeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
  prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'capitals and digits, up to 8'),
  templateId: IdSchema.nullable(),
  variants: z
    .array(z.object({ templateId: IdSchema, label: z.string().trim().min(2).max(60) }))
    .max(10)
    .default([]),
  rules: RulesSchema,
  multiple: z.enum(['ONE', 'YEAR', 'ANY']),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  issuers: z.array(IdSchema).max(20).default([]),
  fields: z.array(FieldSpecSchema).max(30).default([]),
});
export class UpdateTypeDto extends createZodDto(UpdateTypeSchema) {}

export const CreateTypeSchema = z.object({
  code: TypeCode,
  name: z.string().trim().min(2).max(100),
  audience: z.enum(['STUDENT', 'STAFF']),
  prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'capitals and digits, up to 8'),
  /** start from this template (a copy is made for the new type) */
  copyTemplateId: IdSchema.optional(),
});
export class CreateTypeDto extends createZodDto(CreateTypeSchema) {}

const Page = z.string().regex(/^\d{2,4}(\.\d)?mm$/, 'in mm, e.g. 210mm');
export const SaveTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  pageWidth: Page,
  pageHeight: Page,
  bodyHtml: z.string().min(1).max(200_000),
  stylesCss: z.string().max(100_000).default(''),
});
export class SaveTemplateDto extends createZodDto(SaveTemplateSchema) {}

export const CreateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** a copy of this template */
  copyOf: IdSchema,
});
export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}

export const TemplatePreviewSchema = z.object({
  typeCode: TypeCode,
  studentId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  pageWidth: Page,
  pageHeight: Page,
  bodyHtml: z.string().min(1).max(200_000),
  stylesCss: z.string().max(100_000).default(''),
});
export class TemplatePreviewDto extends createZodDto(TemplatePreviewSchema) {}

export const SettingsSchema = z.object({
  signatoryEmployeeId: IdSchema.nullable(),
  signatoryTitle: z.string().trim().min(2).max(60),
  printSignature: z.boolean(),
  printPreparer: z.boolean(),
  footerNote: z.string().trim().max(200).optional(),
});
export class SettingsDto extends createZodDto(SettingsSchema) {}
