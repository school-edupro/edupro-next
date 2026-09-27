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
