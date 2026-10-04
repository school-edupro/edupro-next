import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const GATE = {
  view: 'engagement.gate_pass.view',
  issue: 'engagement.gate_pass.issue',
  handover: 'engagement.gate_pass.handover',
  gate: 'engagement.gate_pass.gate',
  setup: 'engagement.gate_pass_setup.manage',
  family: 'engagement.family.view',
} as const;

export const PASS_STATES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'handed_over',
  'out',
  'returned',
] as const;
export type PassState = (typeof PASS_STATES)[number];

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Mobile = z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number');
/** Blank form fields arrive as empty strings (and unset ones as null). */
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    s.optional(),
  );

/** A pupil's pass: leaving early with someone, or arriving late. */
export const StudentPassSchema = z
  .object({
    studentId: IdSchema,
    kind: z.enum(['early_leave', 'late_arrival']).default('early_leave'),
    onDate: blank(DateSchema),
    atTime: blank(TimeSchema),
    reason: z.string().trim().min(3).max(300),
    /** Who takes the child: a parent or guardian on the school's record, or someone else. */
    escortKind: blank(z.enum(['father', 'mother', 'guardian', 'other'])),
    escortName: blank(z.string().trim().min(2).max(120)),
    escortRelation: blank(z.string().trim().max(60)),
    escortMobile: blank(Mobile),
  })
  .refine((v) => v.kind !== 'early_leave' || v.escortKind, {
    message: 'Say who takes the child',
    path: ['escortKind'],
  })
  .refine((v) => v.escortKind !== 'other' || (v.escortName && v.escortMobile), {
    message: 'Give the name and mobile of the person who takes the child',
    path: ['escortName'],
  });
export class StudentPassDto extends createZodDto(StudentPassSchema) {}

/** A member of staff going out: RGP comes back the same day, NRGP does not. */
export const StaffPassSchema = z
  .object({
    category: z.enum(['rgp', 'nrgp']),
    onDate: blank(DateSchema),
    atTime: TimeSchema,
    returnTime: blank(TimeSchema),
    reason: z.string().trim().min(3).max(300),
    destination: blank(z.string().trim().max(160)),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(120),
          qty: z.coerce.number().int().min(1).max(9999).default(1),
          serialNo: blank(z.string().trim().max(60)),
          returnable: z.coerce.boolean().default(true),
        }),
      )
      .max(30)
      .default([]),
  })
  .refine((v) => v.category !== 'rgp' || v.returnTime, {
    message: 'Say by when you will be back',
    path: ['returnTime'],
  })
  .refine((v) => !v.returnTime || v.returnTime > v.atTime, {
    message: 'The return time must be after the time out',
    path: ['returnTime'],
  });
export class StaffPassDto extends createZodDto(StaffPassSchema) {}

export const PassDecideSchema = z
  .object({
    outcome: z.enum(['approved', 'rejected']),
    note: blank(z.string().trim().max(300)),
  })
  .refine((v) => v.outcome !== 'rejected' || v.note, {
    message: 'Give the reason',
    path: ['note'],
  });
export class PassDecideDto extends createZodDto(PassDecideSchema) {}

export const HandoverSchema = z.object({
  /** The person collecting, taken live at the front desk (a small image as a data URL). */
  photo: z.string().min(100).max(420_000),
  otp: blank(z.string().regex(/^\d{6}$/, 'the 6-digit code')),
  /** What the front desk noted (ID seen, parent spoken to); needed when an outsider collects. */
  remark: blank(z.string().trim().min(3).max(300)),
});
export class HandoverDto extends createZodDto(HandoverSchema) {}

export const GateOutSchema = z.object({
  gate: blank(z.string().trim().max(40)),
  note: blank(z.string().trim().max(300)),
});
export class GateOutDto extends createZodDto(GateOutSchema) {}
export const GateInSchema = z.object({
  note: blank(z.string().trim().max(300)),
  /** How many of each returnable item came back. */
  items: z
    .array(z.object({ id: IdSchema, returnedQty: z.coerce.number().int().min(0).max(9999) }))
    .max(30)
    .default([]),
});
export class GateInDto extends createZodDto(GateInSchema) {}
export const GateFindPassSchema = z.object({ code: z.string().trim().min(2).max(120) });
export class GateFindPassDto extends createZodDto(GateFindPassSchema) {}
export const PassCancelSchema = z.object({ reason: blank(z.string().trim().max(300)) });
export class PassCancelDto extends createZodDto(PassCancelSchema) {}

export const STAGES = ['approval', 'handover', 'gate', 'out', 'closed', 'today', 'all'] as const;
export const ListPassesSchema = z.object({
  stage: z.enum(STAGES).default('approval'),
  audience: z.enum(['student', 'staff']).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class ListPassesDto extends createZodDto(ListPassesSchema) {}
export const ExportPassesSchema = ListPassesSchema.omit({ page: true, size: true });
export class ExportPassesDto extends createZodDto(ExportPassesSchema) {}

/** A family's or an employee's own passes: open = still running, past = over or closed. */
export const MyPassesSchema = z.object({
  state: z.enum(['open', 'past']).optional(),
  studentId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(10),
});
export class MyPassesDto extends createZodDto(MyPassesSchema) {}

const LevelSchema = z
  .object({
    audience: z.enum(['student', 'staff']),
    label: z.string().trim().min(2).max(60),
    kind: z.enum(['class_teacher', 'role', 'designation', 'employee']),
    roleCode: blank(z.string().trim().max(60)),
    designation: blank(z.string().trim().max(80)),
    employeeId: blank(IdSchema),
    active: z.boolean().default(true),
    /** In "any N" mode: this level must approve whatever the others do. */
    mandatory: z.boolean().default(false),
  })
  .refine((v) => v.kind !== 'class_teacher' || v.audience === 'student', {
    message: 'The class teacher approves pupil passes only',
    path: ['kind'],
  })
  .refine((v) => v.kind !== 'role' || v.roleCode, { message: 'Pick the role', path: ['roleCode'] })
  .refine((v) => v.kind !== 'designation' || v.designation, {
    message: 'Give the designation',
    path: ['designation'],
  })
  .refine((v) => v.kind !== 'employee' || v.employeeId, {
    message: 'Pick the employee',
    path: ['employeeId'],
  });
export const GatePassSetupSchema = z.object({
  studentMode: z.enum(['sequence', 'any']),
  studentNeed: z.number().int().min(1).max(6),
  staffMode: z.enum(['sequence', 'any']),
  staffNeed: z.number().int().min(1).max(6),
  handoverOtp: z.boolean(),
  notifyEmail: z.boolean(),
  /** In the order they approve; the levels of each audience keep their own order. */
  levels: z.array(LevelSchema).max(16),
});
export class GatePassSetupDto extends createZodDto(GatePassSetupSchema) {}
