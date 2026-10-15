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
