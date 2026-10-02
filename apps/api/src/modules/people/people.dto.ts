import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const IdSchema = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, '10-digit Indian mobile number');
export const GenderSchema = z.enum(['male', 'female', 'other', 'unspecified']);
export const RelationSchema = z.enum([
  'father',
  'mother',
  'guardian',
  'grandparent',
  'sibling',
  'other',
]);
export const DocumentKindSchema = z.enum([
  'photo',
  'birth_certificate',
  'aadhaar',
  'transfer_certificate',
  'address_proof',
  'category_certificate',
  'medical',
  'pan',
  'bank',
  'qualification',
  'other',
]);

// ---- guardians -----------------------------------------------------------------------------------
export const NewGuardianSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  mobile: Mobile.optional(),
  email: z.string().trim().email().optional(),
  occupation: z.string().trim().max(80).optional(),
  address: z.record(z.string(), z.unknown()).default({}),
});

export const LinkGuardianSchema = z
  .object({
    guardianId: IdSchema.optional(),
    guardian: NewGuardianSchema.optional(),
    relation: RelationSchema,
    isPrimary: z.boolean().default(false),
    receivesNotifications: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.guardianId) !== Boolean(v.guardian), {
    message: 'give guardianId or a new guardian, not both',
    path: ['guardianId'],
  });
export class LinkGuardianDto extends createZodDto(LinkGuardianSchema) {}

// ---- enrolments ----------------------------------------------------------------------------------
export const EnrolSchema = z.object({
  academicYearId: IdSchema.optional(),
  classSectionId: IdSchema,
  rollNo: z.number().int().min(1).max(999).optional(),
  joinedOn: DateSchema.optional(),
});
export class EnrolDto extends createZodDto(EnrolSchema) {}

// ---- students ------------------------------------------------------------------------------------
const StudentCore = z.object({
  admissionNo: z.string().trim().min(1).max(30),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dob: DateSchema.optional(),
  gender: GenderSchema.default('unspecified'),
  category: z.string().trim().max(40).optional(),
  bloodGroup: z.string().trim().max(5).optional(),
  house: z.string().trim().max(40).optional(),
  admittedOn: DateSchema.optional(),
  address: z.record(z.string(), z.unknown()).default({}),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const CreateStudentSchema = StudentCore.extend({
  guardians: z.array(LinkGuardianSchema).max(4).default([]),
  enrolment: EnrolSchema.optional(),
});
export class CreateStudentDto extends createZodDto(CreateStudentSchema) {}

export const UpdateStudentSchema = StudentCore.omit({ admissionNo: true })
  .extend({
    // optional text fields can be cleared: the edit form sends null for an emptied box
    lastName: z.string().trim().max(80).nullable(),
    category: z.string().trim().max(40).nullable(),
    bloodGroup: z.string().trim().max(10).nullable(),
    house: z.string().trim().max(40).nullable(),
    status: z.enum(['active', 'inactive']),
    /** Recorded in student_status_history when the status changes (S6-06). */
    statusReason: z.string().trim().max(200),
    leftOn: DateSchema.nullable(),
    photoFileId: IdSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}

export const ListStudentsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  classSectionId: IdSchema.optional(),
  academicYearId: IdSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListStudentsQueryDto extends createZodDto(ListStudentsQuerySchema) {}

// ---- student 360 profile -------------------------------------------------------------------------
const ProfileRaw = z.union([z.string().max(300), z.number(), z.null()]);
export const UpdateProfileSchema = z.object({
  values: z
    .record(z.string().max(60), ProfileRaw)
    .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 250, {
      message: 'send between 1 and 250 fields',
    }),
});
export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

export const QuickAddSchema = z.object({
  values: z.record(z.string().max(60), ProfileRaw),
  classSectionId: IdSchema,
  rollNo: z.number().int().min(1).max(999).optional(),
});
export class QuickAddDto extends createZodDto(QuickAddSchema) {}

export const NextNumbersQuerySchema = z.object({ classSectionId: IdSchema.optional() });
export class NextNumbersQueryDto extends createZodDto(NextNumbersQuerySchema) {}

export const ProfileQuerySchema = z.object({ academicYearId: IdSchema.optional() });
export class ProfileQueryDto extends createZodDto(ProfileQuerySchema) {}

export const BulkTemplateQuerySchema = z.object({
  mode: z.enum(['update', 'create']).default('update'),
  classSectionId: IdSchema.optional(),
  /** Comma-separated profile field keys; all editable fields when omitted. */
  fields: z.string().max(4000).optional(),
});
export class BulkTemplateQueryDto extends createZodDto(BulkTemplateQuerySchema) {}

export const BulkUploadSchema = z
  .object({
    mode: z.enum(['update', 'create']),
    fileName: z.string().trim().max(200).optional(),
    csv: z.string().max(2_000_000).optional(),
    contentBase64: z.string().max(8_000_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'send csv text or an xlsx file',
  });
export class BulkUploadDto extends createZodDto(BulkUploadSchema) {}

const GridKey = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{2,60}$/, 'unknown field');
export const StudentGridSchema = z.object({
  columns: z
    .array(z.object({ key: GridKey, label: z.string().trim().max(80).nullable().optional() }))
    .max(60)
    .default([]),
  filters: z
    .array(
      z.object({
        key: GridKey,
        op: z.enum([
          'eq',
          'neq',
          'in',
          'not_in',
          'contains',
          'starts',
          'empty',
          'not_empty',
          'between',
          'gte',
          'lte',
        ]),
        values: z.array(z.string().trim().max(120)).max(200).optional(),
      }),
    )
    .max(30)
    .default([]),
  sort: z
    .array(z.object({ key: GridKey, dir: z.enum(['asc', 'desc']).default('asc') }))
    .max(3)
    .default([]),
  search: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive', 'withdrawn', 'all']).default('active'),
  academicYearId: IdSchema.optional(),
  page: z.number().int().min(1).default(1),
  size: z.number().int().min(10).max(200).default(50),
});
export class StudentGridDto extends createZodDto(StudentGridSchema) {}

export const StudentGridExportSchema = StudentGridSchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  title: z.string().trim().max(120).optional(),
});
export class StudentGridExportDto extends createZodDto(StudentGridExportSchema) {}

// ---- documents -----------------------------------------------------------------------------------
export const AddDocumentSchema = z.object({
  kind: DocumentKindSchema,
  fileId: IdSchema,
  title: z.string().trim().max(120).optional(),
  number: z.string().trim().max(40).optional(),
  issuedOn: DateSchema.optional(),
  expiresOn: DateSchema.optional(),
});
export class AddDocumentDto extends createZodDto(AddDocumentSchema) {}

export const ReplaceDocumentSchema = z.object({
  fileId: IdSchema,
  title: z.string().trim().max(120).optional(),
  number: z.string().trim().max(40).optional(),
  issuedOn: DateSchema.optional(),
  expiresOn: DateSchema.optional(),
});
export class ReplaceDocumentDto extends createZodDto(ReplaceDocumentSchema) {}

export const ParentPhotoSchema = z.object({
  party: z.enum(['father', 'mother', 'guardian']),
  fileId: IdSchema,
});
export class ParentPhotoDto extends createZodDto(ParentPhotoSchema) {}

export const VerifyDocumentSchema = z.object({ verified: z.boolean() });
export class VerifyDocumentDto extends createZodDto(VerifyDocumentSchema) {}

// ---- employees -----------------------------------------------------------------------------------
export const UpsertPostingSchema = z.object({
  academicYearId: IdSchema.optional(),
  campusId: IdSchema.nullable().optional(),
  department: z.string().trim().max(80).optional(),
  designation: z.string().trim().max(80).optional(),
  reportsToEmployeeId: IdSchema.nullable().optional(),
  validFrom: DateSchema.optional(),
  validTo: DateSchema.nullable().optional(),
});
export class UpsertPostingDto extends createZodDto(UpsertPostingSchema) {}

const EmployeeCore = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dob: DateSchema.optional(),
  gender: GenderSchema.default('unspecified'),
  employeeType: z.enum(['teaching', 'non_teaching', 'contract', 'visiting']).default('teaching'),
  designation: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
  joinedOn: DateSchema.optional(),
  mobile: Mobile.optional(),
  email: z.string().trim().email().optional(),
  address: z.record(z.string(), z.unknown()).default({}),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const CreateEmployeeSchema = EmployeeCore.extend({
  posting: UpsertPostingSchema.optional(),
});
export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}

export const UpdateEmployeeSchema = EmployeeCore.omit({ employeeCode: true })
  .extend({
    status: z.enum(['active', 'inactive']),
    /** Recorded in student_status_history when the status changes (S6-06). */
    statusReason: z.string().trim().max(200),
    leftOn: DateSchema.nullable(),
    photoFileId: IdSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}

export const ListEmployeesQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  employeeType: z.enum(['teaching', 'non_teaching', 'contract', 'visiting']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListEmployeesQueryDto extends createZodDto(ListEmployeesQuerySchema) {}

// ---- search --------------------------------------------------------------------------------------
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class SearchQueryDto extends createZodDto(SearchQuerySchema) {}

export const ChangeAdmissionNoSchema = z.object({
  admissionNo: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9/\-]+$/, 'letters, digits, / and - only'),
  reason: z.string().trim().min(3).max(300),
});
export class ChangeAdmissionNoDto extends createZodDto(ChangeAdmissionNoSchema) {}
