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
