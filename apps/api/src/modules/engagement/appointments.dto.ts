import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const APPOINTMENTS = {
  view: 'engagement.appointment.view',
  decide: 'engagement.appointment.decide',
  checkin: 'engagement.appointment.checkin',
  setup: 'engagement.appointment_setup.manage',
  family: 'engagement.family.view',
} as const;

export const STATES = [
  'requested',
  'approved',
  'rejected',
  'cancelled',
  'checked_in',
  'completed',
  'no_show',
] as const;
export type AppointmentState = (typeof STATES)[number];

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** A slot start in school time (India): 2026-10-05T09:30. */
const SlotSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:MM');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Mobile = z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number');
const Note = z.string().trim().max(300).optional();
/** Blank form fields arrive as empty strings. */
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());

export const ListAppointmentsSchema = z.object({
  /** A state, or: open = waiting for the front desk, upcoming = confirmed and still to come, today. */
  state: z.enum([...STATES, 'open', 'upcoming', 'today']).optional(),
  hostId: IdSchema.optional(),
  source: z.enum(['parent', 'public', 'front_desk']).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** Only the appointments with me (the person to be met). */
  mine: z.coerce.boolean().default(false),
  order: z.enum(['latest', 'time']).default('latest'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class ListAppointmentsDto extends createZodDto(ListAppointmentsSchema) {}
export const ExportAppointmentsSchema = ListAppointmentsSchema.omit({ page: true, size: true });
export class ExportAppointmentsDto extends createZodDto(ExportAppointmentsSchema) {}

export const SlotsQuerySchema = z.object({
  hostId: IdSchema,
  date: DateSchema,
  /** For "class teacher": whose class teacher. */
  studentId: IdSchema.optional(),
});
export class SlotsQueryDto extends createZodDto(SlotsQuerySchema) {}

export const CalendarQuerySchema = z.object({
  from: DateSchema,
  to: DateSchema,
  hostId: IdSchema.optional(),
  mine: z.coerce.boolean().default(false),
});
export class CalendarQueryDto extends createZodDto(CalendarQuerySchema) {}

const VisitorFields = {
  visitorName: z.string().trim().min(2).max(120),
  visitorEmail: blank(z.string().trim().toLowerCase().email().max(200)),
  visitorOrg: blank(z.string().trim().max(120)),
  partySize: z.coerce.number().int().min(1).max(20).default(1),
  idProofKind: blank(z.string().trim().max(40)),
  /** Only the last four characters of the document number are ever taken. */
  idProofLast4: blank(z.string().regex(/^[A-Za-z0-9]{4}$/, 'the last 4 characters')),
  /** A small image as a data URL (made small in the browser). */
  photo: blank(z.string().max(420_000)),
};

/** The front desk books for a walk-in or a caller, or for a parent about a pupil. */
export const DeskBookSchema = z
  .object({
    hostId: IdSchema,
    startsAt: SlotSchema,
    purpose: z.string().trim().min(3).max(500),
    studentId: blank(IdSchema),
    ...VisitorFields,
    visitorName: blank(z.string().trim().min(2).max(120)),
    visitorMobile: blank(Mobile),
    /** Confirm at once (the usual case at the desk) or leave it as a request. */
    approve: z.coerce.boolean().default(true),
  })
  .refine((v) => v.studentId || v.visitorName, {
    message: 'Give the visitor name or pick a student',
    path: ['visitorName'],
  });
export class DeskBookDto extends createZodDto(DeskBookSchema) {}

export const FamilyBookSchema = z.object({
  studentId: IdSchema,
  hostId: IdSchema,
  startsAt: SlotSchema,
  purpose: z.string().trim().min(3).max(500),
});
export class FamilyBookDto extends createZodDto(FamilyBookSchema) {}

export const PublicBookSchema = z.object({
  hostId: IdSchema,
  startsAt: SlotSchema,
  purpose: z.string().trim().min(3).max(500),
  ...VisitorFields,
  /** The visitor agreed to the school keeping these details for the visit. */
  consent: z.literal(true),
});
export class PublicBookDto extends createZodDto(PublicBookSchema) {}

export const ApproveSchema = z.object({ note: Note, location: blank(z.string().trim().max(120)) });
export class ApproveDto extends createZodDto(ApproveSchema) {}
export const RejectSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class RejectDto extends createZodDto(RejectSchema) {}
export const RescheduleSchema = z.object({
  startsAt: SlotSchema,
  hostId: blank(IdSchema),
  reason: Note,
  location: blank(z.string().trim().max(120)),
});
export class RescheduleDto extends createZodDto(RescheduleSchema) {}
export const CancelSchema = z.object({ reason: Note });
export class CancelDto extends createZodDto(CancelSchema) {}
export const GateFindSchema = z.object({ code: z.string().trim().min(2).max(300) });
export class GateFindDto extends createZodDto(GateFindSchema) {}
export const CheckInSchema = z.object({ badgeNo: blank(z.string().trim().max(20)) });
export class CheckInDto extends createZodDto(CheckInSchema) {}

const Ask = z.enum(['off', 'optional', 'required']);
const Words = (max: number) =>
  z
    .array(z.string().trim().min(2).max(60))
    .min(1)
    .max(max)
    .transform((a) => [...new Set(a)]);
export const AppointmentSettingsSchema = z.object({
  publicEnabled: z.boolean(),
  autoApprove: z.boolean(),
  minNoticeHours: z.number().int().min(0).max(168),
  maxDaysAhead: z.number().int().min(1).max(90),
  maxParty: z.number().int().min(1).max(20),
  askOrganisation: Ask,
  askIdProof: Ask,
  askPhoto: Ask,
  idProofKinds: Words(12),
  purposes: Words(30),
  notifySms: z.boolean(),
  notifyWhatsapp: z.boolean(),
  notifyEmail: z.boolean(),
  reminderHours: z.number().int().min(0).max(72),
  noShowMinutes: z.number().int().min(10).max(600),
  closedDates: z.array(DateSchema).max(200).default([]),
  instructions: z.string().trim().max(1000).nullish(),
});
export class AppointmentSettingsDto extends createZodDto(AppointmentSettingsSchema) {}

export const HostSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(['desk', 'person', 'class_teacher']),
    employeeId: IdSchema.nullish(),
    location: z.string().trim().max(120).nullish(),
    openPublic: z.boolean(),
    openParent: z.boolean(),
    slotMinutes: z.number().int().min(5).max(240),
    capacity: z.number().int().min(1).max(50),
    sortOrder: z.number().int().min(0).max(999).default(0),
    status: z.enum(['active', 'inactive']).default('active'),
    hours: z
      .array(
        z.object({ weekday: z.number().int().min(1).max(7), starts: TimeSchema, ends: TimeSchema }),
      )
      .max(28),
  })
  .refine((v) => v.kind !== 'person' || v.employeeId, {
    message: 'Pick the employee',
    path: ['employeeId'],
  })
  .refine((v) => v.kind !== 'class_teacher' || !v.openPublic, {
    message: 'The class teacher can be met by parents only',
    path: ['openPublic'],
  })
  .refine((v) => v.hours.every((h) => h.ends > h.starts), {
    message: 'Each visiting time must end after it starts',
    path: ['hours'],
  });
export class HostDto extends createZodDto(HostSchema) {}
