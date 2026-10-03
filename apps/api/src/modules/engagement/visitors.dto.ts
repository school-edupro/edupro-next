import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const VISITORS = { manage: 'engagement.visitor.manage' } as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** Blank form fields arrive as empty strings. */
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());

const Fields = {
  visitorName: z.string().trim().min(2).max(120),
  visitorType: blank(z.string().trim().max(60)),
  organisation: blank(z.string().trim().max(120)),
  email: blank(z.string().trim().toLowerCase().email().max(200)),
  partySize: z.coerce.number().int().min(1).max(50).default(1),
  idProofKind: blank(z.string().trim().max(40)),
  /** Only the last four characters of the document number are ever taken. */
  idProofLast4: blank(z.string().regex(/^[A-Za-z0-9]{4}$/, 'the last 4 characters')),
  vehicleNo: blank(z.string().trim().max(20)),
  /** What the visitor carries in for work: one line (laptop, tool kit, 2 cartons...). */
  equipment: blank(z.string().trim().max(300)),
  hostId: blank(IdSchema),
  /** Whom to meet when it is not one of the listed people or desks. */
  toMeet: blank(z.string().trim().max(120)),
  purpose: z.string().trim().min(3).max(300),
  /** A small image as a data URL, taken live with the camera. */
  photo: blank(z.string().max(420_000)),
};

/** The guard registers a walk-in visitor and lets them in. */
export const RegisterVisitorSchema = z.object({
  ...Fields,
  mobile: blank(z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number')),
  gate: blank(z.string().trim().max(40)),
  badgeNo: blank(z.string().trim().max(20)),
});
export class RegisterVisitorDto extends createZodDto(RegisterVisitorSchema) {}

/** A visitor registers on their own phone (mobile already confirmed by a one-time code) and waits at the gate. */
export const SelfRegisterSchema = z.object({ ...Fields, consent: z.literal(true) });
export class SelfRegisterDto extends createZodDto(SelfRegisterSchema) {}

export const ListVisitorsSchema = z.object({
  /** inside = in the campus now, waiting = registered on their phone and not let in yet, today, left, all. */
  state: z.enum(['inside', 'waiting', 'today', 'left', 'all']).default('inside'),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  hostId: IdSchema.optional(),
  type: z.string().trim().max(60).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class ListVisitorsDto extends createZodDto(ListVisitorsSchema) {}
export const ExportVisitorsSchema = ListVisitorsSchema.omit({ page: true, size: true });
export class ExportVisitorsDto extends createZodDto(ExportVisitorsSchema) {}

export const AdmitVisitorSchema = z.object({
  gate: blank(z.string().trim().max(40)),
  badgeNo: blank(z.string().trim().max(20)),
});
export class AdmitVisitorDto extends createZodDto(AdmitVisitorSchema) {}

export const ExitVisitorSchema = z.object({
  exitGate: blank(z.string().trim().max(40)),
  /** For example: equipment taken back, or what was left behind. */
  note: blank(z.string().trim().max(300)),
});
export class ExitVisitorDto extends createZodDto(ExitVisitorSchema) {}

export const LookupSchema = z.object({ mobile: z.string().regex(/^[6-9]\d{9}$/) });
export class LookupDto extends createZodDto(LookupSchema) {}
