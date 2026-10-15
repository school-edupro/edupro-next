import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const HOSTEL = {
  view: 'hostel.room.view',
  setup: 'hostel.setup.manage',
  allot: 'hostel.allot.manage',
} as const;

export const HostelSchema = z.object({
  name: Text(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,12}$/, 'letters, digits, - or _ (up to 12)'),
  gender: z.enum(['boys', 'girls', 'mixed']).default('mixed'),
  address: Optional(300),
  phone: Optional(30),
  status: z.enum(['active', 'closed']).default('active'),
});
export class HostelDto extends createZodDto(HostelSchema) {}

export const BlockSchema = z.object({
  hostelId: IdSchema,
  name: Text(40),
  floors: z.number().int().min(1).max(40).default(1),
});
export class BlockDto extends createZodDto(BlockSchema) {}

export const RoomTypeSchema = z.object({
  name: Text(60),
  seater: z.number().int().min(1).max(40),
  ac: z.boolean().default(false),
  feeGroup: z
    .string()
    .trim()
    .regex(/^[a-z_]{0,30}$/, 'small letters and _ (a fee group of Fee structures)')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});
export class RoomTypeDto extends createZodDto(RoomTypeSchema) {}

export const RoomSchema = z.object({
  hostelId: IdSchema,
  blockId: IdSchema.nullable().optional(),
  floor: z.number().int().min(0).max(40).default(0),
  roomNo: Text(20),
  roomTypeId: IdSchema,
  status: z.enum(['active', 'maintenance', 'closed']).default('active'),
  remarks: Optional(300),
  /** beds made with the room (A, B, C ...); default: the room type's seater */
  beds: z.number().int().min(0).max(40).optional(),
});
export class RoomDto extends createZodDto(RoomSchema) {}

export const RoomUpdateSchema = RoomSchema.omit({ beds: true }).partial();
export class RoomUpdateDto extends createZodDto(RoomUpdateSchema) {}

export const BedSchema = z.object({
  label: Text(10),
  status: z.enum(['active', 'blocked']).default('active'),
});
export class BedDto extends createZodDto(BedSchema) {}

export const WardensSchema = z.object({
  wardens: z.array(z.object({ employeeId: IdSchema, isHead: z.boolean().default(false) })).max(20),
});
export class WardensDto extends createZodDto(WardensSchema) {}

export const AllotSchema = z.object({
  studentId: IdSchema,
  bedId: IdSchema,
  fromDate: DateSchema,
  remarks: Optional(300),
});
export class AllotDto extends createZodDto(AllotSchema) {}

export const TransferSchema = z.object({
  bedId: IdSchema,
  onDate: DateSchema,
  remarks: Optional(300),
});
export class TransferDto extends createZodDto(TransferSchema) {}

export const VacateSchema = z.object({
  onDate: DateSchema,
  reason: z.enum(['vacate', 'withdrawn']).default('vacate'),
  remarks: Optional(300),
});
export class VacateDto extends createZodDto(VacateSchema) {}

export const BoardQuerySchema = z.object({
  hostelId: IdSchema.optional(),
  /** the day the board shows (default today) */
  on: DateSchema.optional(),
});
export class BoardQueryDto extends createZodDto(BoardQuerySchema) {}

export const RegisterQuerySchema = z.object({
  hostelId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  open: z.enum(['open', 'ended', 'all']).default('all'),
  q: z.string().trim().max(60).optional(),
});
export class RegisterQueryDto extends createZodDto(RegisterQuerySchema) {}

export const ImportSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  fileBase64: z.string().min(100).max(950_000),
  /** false = check only (nothing kept) */
  apply: z.boolean().default(false),
});
export class ImportDto extends createZodDto(ImportSchema) {}

// ---- H2: roll-call, leave, settings ------------------------------------------------------------------------
export const HOSTEL_H2 = {
  rollcall: 'hostel.rollcall.mark',
  leave: 'hostel.leave.view',
} as const;

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const HostelSettingsSchema = z.object({
  lateGraceMinutes: z.number().int().min(0).max(1440),
  escalateAfterHours: z.number().int().min(1).max(168),
  outingReturnBy: TimeSchema,
  alertParentAbsent: z.boolean(),
});
export class HostelSettingsDto extends createZodDto(HostelSettingsSchema) {}

export const SessionSchema = z.object({
  hostelId: IdSchema,
  name: Text(40),
  atTime: TimeSchema,
  active: z.boolean().default(true),
});
export class SessionDto extends createZodDto(SessionSchema) {}

export const RollcallQuerySchema = z.object({
  sessionId: IdSchema,
  on: DateSchema.optional(),
});
export class RollcallQueryDto extends createZodDto(RollcallQuerySchema) {}

export const RollcallSaveSchema = z.object({
  sessionId: IdSchema,
  on: DateSchema,
  marks: z
    .array(
      z.object({
        studentId: IdSchema,
        status: z.enum(['present', 'absent', 'on_leave', 'sick']),
        note: Optional(200),
      }),
    )
    .min(1)
    .max(2000),
});
export class RollcallSaveDto extends createZodDto(RollcallSaveSchema) {}

export const LeavesQuerySchema = z.object({
  hostelId: IdSchema.optional(),
  /** out = away now; overdue = past the return time; handover = home leave approved for today; all = the last 500 */
  show: z.enum(['out', 'overdue', 'handover', 'pending', 'all']).default('out'),
});
export class LeavesQueryDto extends createZodDto(LeavesQuerySchema) {}

export const RollcallReportSchema = z.object({
  hostelId: IdSchema.optional(),
  from: DateSchema,
  to: DateSchema,
});
export class RollcallReportDto extends createZodDto(RollcallReportSchema) {}

// ---- H3: visitors and the mess --------------------------------------------------------------------------
export const HOSTEL_H3 = {
  visitView: 'hostel.visit.view',
  visitDecide: 'hostel.visit.decide',
  visitGate: 'hostel.visit.gate',
  mess: 'hostel.mess.manage',
  family: 'engagement.family.view',
} as const;

const Mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, '10-digit mobile');
const Photo = z.string().max(420_000).optional();

export const VisitorAddSchema = z.object({
  studentId: IdSchema,
  name: Text(120),
  relation: Text(60),
  mobile: Mobile,
  /** a small photo as a data URL (image/jpeg, png or webp) */
  photo: Photo,
});
export class VisitorAddDto extends createZodDto(VisitorAddSchema) {}

export const DecideSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: Optional(300),
});
export class DecideDto extends createZodDto(DecideSchema) {}

export const VisitorsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  studentId: IdSchema.optional(),
  hostelId: IdSchema.optional(),
});
export class VisitorsQueryDto extends createZodDto(VisitorsQuerySchema) {}

export const VisitCheckSchema = z.object({ studentId: IdSchema, mobile: Mobile.optional() });
export class VisitCheckDto extends createZodDto(VisitCheckSchema) {}

export const VisitSchema = z.object({
  studentId: IdSchema,
  visitorName: Text(120),
  mobile: Mobile,
  relation: Text(60),
  partySize: z.number().int().min(1).max(20).default(1),
  idProofKind: Optional(40),
  idProofLast4: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4}$/)
    .optional(),
  gate: Optional(40),
  photo: Photo,
});
export class VisitDto extends createZodDto(VisitSchema) {}

export const VisitDecideSchema = z.object({
  outcome: z.enum(['allowed', 'refused']),
  note: Optional(300),
});
export class VisitDecideDto extends createZodDto(VisitDecideSchema) {}

export const VisitsQuerySchema = z.object({
  show: z.enum(['waiting', 'inside', 'today', 'all']).default('today'),
  hostelId: IdSchema.optional(),
});
export class VisitsQueryDto extends createZodDto(VisitsQuerySchema) {}

export const VisitHoursSchema = z.object({
  hours: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), from: TimeSchema, to: TimeSchema }))
    .max(30)
    .refine((h) => h.every((x) => x.to > x.from), 'Each slot must end after it starts'),
});
export class VisitHoursDto extends createZodDto(VisitHoursSchema) {}

export const MealSchema = z.object({
  hostelId: IdSchema,
  name: Text(40),
  atTime: TimeSchema,
  active: z.boolean().default(true),
});
export class MealDto extends createZodDto(MealSchema) {}

export const MenuWeekSchema = z.object({
  hostelId: IdSchema,
  entries: z
    .array(
      z.object({
        mealId: IdSchema,
        weekday: z.number().int().min(0).max(6),
        items: z.string().trim().max(500),
      }),
    )
    .max(200),
});
export class MenuWeekDto extends createZodDto(MenuWeekSchema) {}

export const MenuChangeSchema = z.object({
  mealId: IdSchema,
  onDate: DateSchema,
  /** empty = back to the weekly menu */
  items: z.string().trim().max(500),
  note: Optional(200),
});
export class MenuChangeDto extends createZodDto(MenuChangeSchema) {}

export const MenuQuerySchema = z.object({ hostelId: IdSchema, weekOf: DateSchema.optional() });
export class MenuQueryDto extends createZodDto(MenuQuerySchema) {}

export const MealRollQuerySchema = z.object({ mealId: IdSchema, on: DateSchema.optional() });
export class MealRollQueryDto extends createZodDto(MealRollQuerySchema) {}

export const MealRollSaveSchema = z.object({
  mealId: IdSchema,
  on: DateSchema,
  skips: z.array(z.object({ studentId: IdSchema, reason: Optional(120) })).max(2000),
});
export class MealRollSaveDto extends createZodDto(MealRollSaveSchema) {}

export const DietSchema = z.object({
  diet: z.enum(['veg', 'non_veg', 'eggetarian', 'jain', 'vegan']),
  noOnionGarlic: z.boolean().default(false),
  notes: Optional(200),
});
export class DietDto extends createZodDto(DietSchema) {}
