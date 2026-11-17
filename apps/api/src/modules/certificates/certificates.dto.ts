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

/** the person's printed details, by where the layout reads them (student.fatherName, tc.lastClass …) */
const PersonDetails = z
  .record(z.string().regex(/^(student|employee|tc)\.[a-zA-Z]{2,30}$/), z.string().max(300))
  .optional();

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
  /** a re-issue with changes (16 Nov 2026): the certificate it replaces, not counted as one already held */
  reissueOf: IdSchema.optional(),
  /** the person's details the layout prints, as the boxes hold them (17 Nov 2026): on this certificate only */
  person: PersonDetails,
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
  /** the request it answers (phase C): approved, its fee paid or waived */
  requestId: IdSchema.optional(),
}).refine(onePerson, { message: 'a student or an employee, not both' });
export class IssueCertificateDto extends createZodDto(IssueCertificateSchema) {}

export const ReasonSchema = z.object({
  reason: z.string().trim().min(3, 'at least 3 characters').max(300),
});
export class ReasonDto extends createZodDto(ReasonSchema) {}
/**
 * A re-issue (16 Nov 2026): the reason, and — "with changes" — what is corrected: the purpose ("" to print none),
 * the typed details (all of them), the date of issue, the layout, the principal's reason for a check not clear.
 */
export const ReissueSchema = ReasonSchema.extend({
  purpose: z.string().trim().max(200).optional(),
  fields: z
    .record(z.string().regex(/^[a-zA-Z]{2,30}$/), z.union([z.string().trim().max(500), z.number()]))
    .optional(),
  issuedOn: DateSchema.optional(),
  variant: IdSchema.optional(),
  overrideReason: z.string().trim().min(10, 'at least 10 characters').max(300).optional(),
  /** the person's printed details (all the boxes); left out, those printed on the earlier one */
  person: PersonDetails,
});
export class ReissueDto extends createZodDto(ReissueSchema) {}

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

/**
 * The issue page's people list (16 Nov 2026): empty lists the first ones (students on the rolls in class order;
 * employees in service); `type` puts those its rule wants first (e.g. those who have left, for a TC).
 */
export const StudentSearchQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  type: TypeCode.optional(),
});
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

/** A layout given to a type from the templates list (17 Nov 2026): the one it prints with, or one more at issue. */
export const UseTemplateSchema = z.object({
  typeCode: TypeCode,
  as: z.enum(['main', 'choice']),
  /** the name the office sees at issue (a choice); the layout's name when left out */
  label: z.string().trim().min(2).max(60).optional(),
});
export class UseTemplateDto extends createZodDto(UseTemplateSchema) {}

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
  /** a correction keeps the certificate number (a new revision) instead of a new number (16 Nov 2026) */
  correctionsKeepNumber: z.boolean().default(false),
});
export class SettingsDto extends createZodDto(SettingsSchema) {}

// ---- requests (phase C) --------------------------------------------------------------------------------------------
const LevelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('office') }),
  z.object({ kind: z.literal('class_teacher') }),
  /** the certificate signatory (the principal set in the settings) */
  z.object({ kind: z.literal('signatory') }),
  z.object({ kind: z.literal('role'), roleId: IdSchema, name: z.string().max(80).optional() }),
  z.object({ kind: z.literal('user'), userId: IdSchema, name: z.string().max(80).optional() }),
]);
export type RequestLevel = z.infer<typeof LevelSchema>;
export const RequestSettingsSchema = z.object({
  open: z.object({ parent: z.boolean(), student: z.boolean(), staff: z.boolean() }),
  purposes: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  maxCopies: z.number().int().min(1).max(10).default(1),
  /** the fee charged a copy (a misc fee on the student), or none */
  fee: z.number().min(0).max(100000).nullable().default(null),
  levels: z.array(LevelSchema).max(5).default([]),
});
export type RequestSettings = z.infer<typeof RequestSettingsSchema>;
export const UpdateRequestSettingsSchema = RequestSettingsSchema;
export class UpdateRequestSettingsDto extends createZodDto(UpdateRequestSettingsSchema) {}

export const CreateRequestSchema = z.object({
  typeCode: TypeCode,
  /** the child (a parent) or the student / employee the office asks for; a student and a staff member ask for themselves */
  studentId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  purpose: z.string().trim().min(2, 'say what it is for').max(200),
  copies: z.number().int().min(1).max(10).default(1),
  note: z.string().trim().max(500).optional(),
});
export class CreateRequestDto extends createZodDto(CreateRequestSchema) {}

export const DecideRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
});
export class DecideRequestDto extends createZodDto(DecideRequestSchema) {}

export const ListRequestsQuerySchema = z.object({
  status: z.enum(['submitted', 'approved', 'issued', 'rejected', 'withdrawn', 'open']).optional(),
  type: TypeCode.optional(),
  /** only those waiting at a level the caller acts at */
  mine: z.enum(['true']).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListRequestsQueryDto extends createZodDto(ListRequestsQuerySchema) {}

// ---- bulk, awards, registers (phase E) ------------------------------------------------------------------------------
/** the most students one bulk issue takes (each issued in its own transaction, in the same request) */
export const BULK_MAX = 600;
const BulkBase = z.object({
  typeCode: TypeCode,
  /**
   * a section's students on the rolls, several sections' (16 Nov 2026: a batch each), chosen students, or the leavers
   * (withdrawal cleared or complete, no TC yet)
   */
  sectionId: IdSchema.optional(),
  sectionIds: z.array(IdSchema).min(1).max(100).optional(),
  studentIds: z.array(IdSchema).max(BULK_MAX).optional(),
  leavers: z.boolean().optional(),
  /** a staff type: the employees of these departments ("" for those with none), in service or who have left */
  departments: z.array(z.string().trim().max(80)).min(1).max(100).optional(),
  staffState: z.enum(['active', 'left']).default('active'),
  purpose: z.string().trim().max(200).optional(),
  issuedOn: DateSchema.optional(),
  fields: Fields,
});
const oneScope = (v: {
  sectionId?: string;
  sectionIds?: string[];
  studentIds?: string[];
  leavers?: boolean;
  departments?: string[];
}) =>
  [
    !!v.sectionId,
    !!v.sectionIds?.length,
    !!v.studentIds?.length,
    !!v.leavers,
    !!v.departments?.length,
  ].filter(Boolean).length === 1;
export const BulkPreviewSchema = BulkBase.refine(oneScope, {
  message: 'a section, chosen students or the leavers',
});
export class BulkPreviewDto extends createZodDto(BulkPreviewSchema) {}
export const BulkIssueSchema = BulkBase.extend({
  title: z.string().trim().min(2).max(200).optional(),
  /** the principal's reason to issue to those whose checks fail too */
  overrideReason: z.string().trim().min(10, 'at least 10 characters').max(300).optional(),
}).refine(oneScope, { message: 'a section, chosen students or the leavers' });
export class BulkIssueDto extends createZodDto(BulkIssueSchema) {}
/** A run (16 Nov 2026): the scope as for the preview, only the students ticked in it, a batch for each section. */
export const BulkRunSchema = BulkBase.extend({
  /** the students ticked in the preview: only these get one */
  only: z.array(IdSchema).min(1, 'tick at least one student').max(BULK_MAX),
  /** the principal's reason, for ticked students whose checks are not clear */
  overrideReason: z.string().trim().min(10, 'at least 10 characters').max(300).optional(),
}).refine(oneScope, { message: 'sections, a section, chosen students or the leavers' });
export class BulkRunDto extends createZodDto(BulkRunSchema) {}

export const AwardSchema = z.object({
  name: z.string().trim().min(2).max(120),
  typeCode: TypeCode,
  description: z.string().trim().max(300).optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});
export class AwardDto extends createZodDto(AwardSchema) {}

export const AllotmentSchema = z.object({
  awardId: IdSchema,
  studentId: IdSchema,
  event: z.string().trim().max(160).optional(),
  position: z.string().trim().max(40).optional(),
  awardedOn: DateSchema,
  remarks: z.string().trim().max(300).optional(),
});
export class AllotmentDto extends createZodDto(AllotmentSchema) {}

export const AllotmentImportSchema = z.object({
  /** CSV: admission_no, award, event, position, date (dd-mm-yyyy or yyyy-mm-dd), remarks */
  csv: z.string().min(10).max(300_000),
  /** only check it (nothing saved) */
  dryRun: z.boolean().default(false),
});
export class AllotmentImportDto extends createZodDto(AllotmentImportSchema) {}

export const ListAllotmentsQuerySchema = z.object({
  award: IdSchema.optional(),
  issued: z.enum(['yes', 'no']).optional(),
  q: z.string().trim().max(80).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListAllotmentsQueryDto extends createZodDto(ListAllotmentsQuerySchema) {}

export const IssueAllotmentsSchema = z.object({
  allotmentIds: z.array(IdSchema).min(1).max(300),
});
export class IssueAllotmentsDto extends createZodDto(IssueAllotmentsSchema) {}

export const TcBookQuerySchema = z.object({
  book: z.coerce.number().int().min(1).max(100000).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(100),
});
export class TcBookQueryDto extends createZodDto(TcBookQuerySchema) {}
export const TcBookFileQuerySchema = TcBookQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class TcBookFileQueryDto extends createZodDto(TcBookFileQuerySchema) {}

export const ReportsQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class ReportsQueryDto extends createZodDto(ReportsQuerySchema) {}
export const ReportsFileQuerySchema = ReportsQuerySchema.extend({
  kind: z.enum(['types', 'months', 'issuers', 'overrides', 'requests']),
  format: z.enum(['xlsx', 'pdf']),
});
export class ReportsFileQueryDto extends createZodDto(ReportsFileQuerySchema) {}

// ---- from the old system (phase F) ----------------------------------------------------------------------------------
export const LegacyMapSchema = z.object({
  /** "<old certificate name>[ (staff)]" → a type code, or null (not brought) */
  map: z.record(z.string().min(1).max(120), TypeCode.nullable()),
});
export class LegacyMapDto extends createZodDto(LegacyMapSchema) {}
export const LegacyBringSchema = z.object({ dryRun: z.boolean().default(true) });
export class LegacyBringDto extends createZodDto(LegacyBringSchema) {}
