import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const ENGAGEMENT_PLUS = {
  appointmentView: 'engagement.appointment.view',
  appointmentDecide: 'engagement.appointment.decide',
  visitorManage: 'engagement.visitor.manage',
  gatePassView: 'engagement.gate_pass.view',
  gatePassIssue: 'engagement.gate_pass.issue',
  consentFormManage: 'engagement.consent_form.manage',
  certificateIssue: 'engagement.certificate.issue',
  clinicManage: 'engagement.clinic.manage',
  cctvRequest: 'engagement.cctv.request',
  cctvDecide: 'engagement.cctv.decide',
  employeeQueryCreate: 'engagement.employee_query.create',
  employeeQueryAnswer: 'engagement.employee_query.answer',
  familyView: 'engagement.family.view',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const Note = z.string().trim().max(500).optional();

// ---- visitors ----
export const VisitorInSchema = z.object({
  visitorName: z.string().trim().min(2).max(120),
  mobile: z
    .string()
    .trim()
    .regex(/^\d{10}$/)
    .optional(),
  organisation: z.string().trim().max(120).optional(),
  purpose: z.string().trim().min(2).max(300),
  toMeet: z.string().trim().max(120).optional(),
  idProofKind: z.string().trim().max(40).optional(),
  badgeNo: z.string().trim().max(20).optional(),
});
export class VisitorInDto extends createZodDto(VisitorInSchema) {}

// ---- gate passes ----
export const GatePassSchema = z.object({
  studentId: IdSchema,
  kind: z.enum(['early_leave', 'late_arrival']),
  onDate: DateSchema.optional(),
  atTime: TimeSchema.optional(),
  reason: z.string().trim().min(3).max(300),
  escortName: z.string().trim().max(120).optional(),
  escortRelation: z.string().trim().max(40).optional(),
  escortMobile: z
    .string()
    .trim()
    .regex(/^\d{10}$/)
    .optional(),
});
export class GatePassDto extends createZodDto(GatePassSchema) {}

export const GatePassDecideSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: Note,
});
export class GatePassDecideDto extends createZodDto(GatePassDecideSchema) {}

// ---- consent forms ----
const FieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: z.string().trim().min(1).max(200),
  type: z.enum(['text', 'choice', 'yesno', 'date', 'signature']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});
export const ConsentFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  fields: z.array(FieldSchema).min(1).max(30),
  audience: z
    .object({ classIds: z.array(IdSchema).default([]), sectionIds: z.array(IdSchema).default([]) })
    .default({ classIds: [], sectionIds: [] }),
  feeAmount: z.number().min(0).nullable().optional(),
  opensOn: DateSchema.optional(),
  closesOn: DateSchema.optional(),
});
export class ConsentFormDto extends createZodDto(ConsentFormSchema) {}

export const ConsentFormStatusSchema = z.object({ status: z.enum(['draft', 'open', 'closed']) });
export class ConsentFormStatusDto extends createZodDto(ConsentFormStatusSchema) {}

export const ConsentResponseSchema = z.object({
  studentId: IdSchema,
  answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()])),
  signedName: z.string().trim().min(2).max(120),
});
export class ConsentResponseDto extends createZodDto(ConsentResponseSchema) {}

// ---- certificates ----
export const IssueCertificatesSchema = z.object({
  templateId: IdSchema,
  classSectionId: IdSchema.optional(),
  studentIds: z.array(IdSchema).max(200).optional(),
  title: z.string().trim().min(2).max(160),
  text: z.string().trim().max(1000).optional(),
  issuedOn: DateSchema.optional(),
});
export class IssueCertificatesDto extends createZodDto(IssueCertificatesSchema) {}

// ---- clinic ----
export const ClinicVisitSchema = z.object({
  studentId: IdSchema,
  complaint: z.string().trim().min(2).max(300),
  treatment: z.string().trim().max(500).optional(),
  temperatureC: z.number().min(30).max(45).optional(),
  referredTo: z.string().trim().max(120).optional(),
  sentHome: z.boolean().default(false),
  notify: z.boolean().default(true),
});
export class ClinicVisitDto extends createZodDto(ClinicVisitSchema) {}

// ---- CCTV and employee queries ----
export const CctvRequestSchema = z.object({
  studentId: IdSchema.optional(),
  camera: z.string().trim().min(2).max(120),
  fromAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  toAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  reason: z.string().trim().min(5).max(500),
});
export class CctvRequestDto extends createZodDto(CctvRequestSchema) {}

export const EmployeeQuerySchema = z.object({
  category: z.enum(['leave', 'payroll', 'facilities', 'grievance', 'other']),
  subject: z.string().trim().min(3).max(160),
  detail: z.string().trim().min(3).max(2000),
});
export class EmployeeQueryDto extends createZodDto(EmployeeQuerySchema) {}

export const DecideSchema = z.object({ outcome: z.enum(['approved', 'rejected']), note: Note });
export class DecideDto extends createZodDto(DecideSchema) {}

export const ListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListQueryDto extends createZodDto(ListQuerySchema) {}
