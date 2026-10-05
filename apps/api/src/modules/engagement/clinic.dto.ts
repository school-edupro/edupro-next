import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const CLINIC = {
  manage: 'engagement.clinic.manage',
  view: 'engagement.clinic.view',
  setup: 'engagement.clinic_setup.manage',
  family: 'engagement.family.view',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
/** Blank form fields arrive as empty strings (and unset ones as null). */
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    s.optional(),
  );
const Text = (max: number) => blank(z.string().trim().max(max));

/**
 * The health check-up form. Height, weight and blood group have their own columns; the rest are short
 * findings ("Normal", "6/6", "2 cavities"). The admin may hide what the school does not examine.
 */
export const CHECKUP_FIELDS = [
  { key: 'height_cm', label: 'Height (cm)', group: 'General' },
  { key: 'weight_kg', label: 'Weight (kg)', group: 'General' },
  { key: 'blood_group', label: 'Blood group', group: 'General' },
  { key: 'nails', label: 'Nails', group: 'General' },
  { key: 'skin', label: 'Skin', group: 'General' },
  { key: 'hair', label: 'Hair', group: 'General' },
  { key: 'anaemia', label: 'Anaemia', group: 'General' },
  { key: 'ear', label: 'Ear', group: 'Eye and ENT' },
  { key: 'nose', label: 'Nose', group: 'Eye and ENT' },
  { key: 'throat', label: 'Throat', group: 'Eye and ENT' },
  { key: 'vision_right', label: 'Right vision', group: 'Eye and ENT' },
  { key: 'vision_left', label: 'Left vision', group: 'Eye and ENT' },
  { key: 'tooth_cavity', label: 'Tooth cavity', group: 'Dental' },
  { key: 'plaque', label: 'Plaque', group: 'Dental' },
  { key: 'stain', label: 'Stain', group: 'Dental' },
  { key: 'tartar', label: 'Tartar', group: 'Dental' },
  { key: 'gums', label: 'Gums', group: 'Dental' },
  { key: 'resp', label: 'Respiratory system', group: 'Systemic' },
  { key: 'cvs', label: 'CVS (heart)', group: 'Systemic' },
  { key: 'pa', label: 'P/A (abdomen)', group: 'Systemic' },
  { key: 'nervous', label: 'Nervous system', group: 'Systemic' },
  { key: 'surgery', label: 'Surgery (past)', group: 'Systemic' },
] as const;
export const FINDING_KEYS = CHECKUP_FIELDS.map((f) => f.key).filter(
  (k) => !['height_cm', 'weight_kg', 'blood_group'].includes(k),
);
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const OUTCOMES = ['back_to_class', 'rest', 'sent_home', 'referred'] as const;

export const MasterSchema = z.object({
  kind: z.enum(['clinic', 'doctor', 'nurse', 'disease']),
  name: z.string().trim().min(2).max(120),
  qualification: Text(120),
  regNo: Text(60),
  mobile: blank(z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number')),
  employeeId: blank(IdSchema),
  note: Text(300),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export class MasterDto extends createZodDto(MasterSchema) {}

export const MedicineSchema = z.object({
  name: z.string().trim().min(2).max(120),
  form: z.string().trim().min(2).max(40).default('Tablet'),
  strength: Text(40),
  unit: z.string().trim().min(1).max(20).default('tablet'),
  lowStockAt: z.coerce.number().int().min(0).max(100000).default(10),
  active: z.boolean().default(true),
});
export class MedicineDto extends createZodDto(MedicineSchema) {}

export const StockInSchema = z.object({
  medicineId: IdSchema,
  qty: z.coerce.number().int().min(1).max(1000000),
  batchNo: Text(60),
  expiryOn: blank(DateSchema),
  receivedOn: blank(DateSchema),
  supplier: Text(120),
  note: Text(300),
});
export class StockInDto extends createZodDto(StockInSchema) {}

export const WriteOffSchema = z.object({
  stockId: IdSchema,
  qty: z.coerce.number().int().min(1).max(1000000),
  note: z.string().trim().min(3).max(300),
});
export class WriteOffDto extends createZodDto(WriteOffSchema) {}

export const ClinicSettingsSchema = z.object({
  /** Keys of built-in fields the school does not use (added fields have their own on/off). */
  checkupHidden: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(60),
  expiryAlertDays: z.coerce.number().int().min(7).max(365),
  cardNote: Text(500),
});
export class ClinicSettingsDto extends createZodDto(ClinicSettingsSchema) {}

const VisitClinical = {
  clinicId: blank(IdSchema),
  doctorId: blank(IdSchema),
  nurseId: blank(IdSchema),
  complaint: z.string().trim().min(2).max(300),
  diseaseIds: z.array(IdSchema).max(10).default([]),
  temperatureC: blank(z.coerce.number().min(30).max(45)),
  pulse: blank(z.coerce.number().int().min(20).max(250)),
  bp: blank(z.string().regex(/^\d{2,3}\/\d{2,3}$/, 'like 110/70')),
  spo2: blank(z.coerce.number().int().min(50).max(100)),
  weightKg: blank(z.coerce.number().min(5).max(250)),
  diagnosis: Text(500),
  treatment: Text(500),
  prescription: Text(1000),
  remark: Text(500),
  outcome: z.enum(OUTCOMES).default('back_to_class'),
  referredTo: Text(160),
};
export const VisitSchema = z
  .object({
    audience: z.enum(['student', 'staff']),
    studentId: blank(IdSchema),
    employeeId: blank(IdSchema),
    /** When the person came in (school time); blank = now. */
    onDate: blank(DateSchema),
    timeIn: blank(TimeSchema),
    timeOut: blank(TimeSchema),
    ...VisitClinical,
    medicines: z
      .array(
        z.object({
          medicineId: IdSchema,
          qty: z.coerce.number().int().min(1).max(1000),
          dosage: Text(120),
        }),
      )
      .max(15)
      .default([]),
  })
  .refine((v) => (v.audience === 'student' ? v.studentId : v.employeeId), {
    message: 'Pick the student or the employee',
    path: ['studentId'],
  })
  .refine((v) => v.outcome !== 'referred' || v.referredTo, {
    message: 'Say where the person is referred to',
    path: ['referredTo'],
  })
  .refine((v) => !(v.outcome === 'rest' && v.timeOut), {
    message:
      'Someone resting in the clinic has no time out yet: leave the time out blank, or choose how the visit ended',
    path: ['timeOut'],
  });
export class VisitDto extends createZodDto(VisitSchema) {}

/** The person leaves the clinic. After resting, the clinic says how the visit ended. */
export const CloseVisitSchema = z
  .object({
    outcome: blank(z.enum(['back_to_class', 'sent_home', 'referred'])),
    referredTo: Text(160),
    remark: Text(500),
  })
  .refine((v) => v.outcome !== 'referred' || v.referredTo, {
    message: 'Say where the person is referred to',
    path: ['referredTo'],
  });
export class CloseVisitDto extends createZodDto(CloseVisitSchema) {}

export const CampPupilsSchema = z.object({ q: z.string().trim().min(2).max(80) });
export class CampPupilsDto extends createZodDto(CampPupilsSchema) {}

export const ListVisitsSchema = z.object({
  tab: z.enum(['today', 'in_clinic', 'all']).default('today'),
  audience: z.enum(['student', 'staff']).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  doctorId: IdSchema.optional(),
  diseaseId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class ListVisitsDto extends createZodDto(ListVisitsSchema) {}
export const ExportVisitsSchema = ListVisitsSchema.omit({ page: true, size: true });
export class ExportVisitsDto extends createZodDto(ExportVisitsSchema) {}

export const PeopleQuerySchema = z.object({
  audience: z.enum(['student', 'staff']),
  q: z.string().trim().min(2).max(80),
});
export class PeopleQueryDto extends createZodDto(PeopleQuerySchema) {}

export const CampSchema = z.object({
  name: z.string().trim().min(3).max(120),
  startsOn: DateSchema,
  endsOn: blank(DateSchema),
  doctorId: blank(IdSchema),
  place: Text(120),
  status: z.enum(['open', 'closed']).default('open'),
});
export class CampDto extends createZodDto(CampSchema) {}

const Finding = Text(120);
export const CheckupSchema = z.object({
  examDate: blank(DateSchema),
  doctorId: blank(IdSchema),
  place: Text(120),
  heightCm: blank(z.coerce.number().min(40).max(230)),
  weightKg: blank(z.coerce.number().min(5).max(200)),
  bloodGroup: blank(z.enum(BLOOD_GROUPS)),
  /** Built-in findings and the school's own fields (x<id>); the service checks the keys. */
  findings: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), Finding).default({}),
  diseaseId: blank(IdSchema),
  description: Text(500),
  remarks: Text(500),
  needsAttention: z.coerce.boolean().default(false),
});
export class CheckupDto extends createZodDto(CheckupSchema) {}

export const DashboardQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class ClinicDashboardDto extends createZodDto(DashboardQuerySchema) {}

/** A field the school adds to the health check-up form, in an existing section or a new one. */
export const FieldSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    section: z.string().trim().min(2).max(40),
    kind: z.enum(['text', 'number', 'choice']).default('text'),
    unit: Text(20),
    options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'choice' || v.options.length >= 2, {
    message: 'Give at least two choices',
    path: ['options'],
  });
export class FieldDto extends createZodDto(FieldSchema) {}

export const SETUP_KINDS = ['clinic', 'doctor', 'nurse', 'disease', 'medicine'] as const;
export const SetupListSchema = z.object({
  kind: z.enum(SETUP_KINDS),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(10),
});
export class SetupListDto extends createZodDto(SetupListSchema) {}
export const SetupExportSchema = SetupListSchema.omit({ page: true, size: true });
export class SetupExportDto extends createZodDto(SetupExportSchema) {}

/** An Excel file as base64 (the API reads it; nothing is stored). */
export const ImportSchema = z.object({
  kind: z.enum([...SETUP_KINDS, 'stock']),
  // the API takes 1 MB of JSON: an Excel of about 700 KB
  fileBase64: z.string().min(100).max(950_000),
});
export class ImportDto extends createZodDto(ImportSchema) {}

export const StockListSchema = z.object({
  view: z.enum(['medicines', 'batches', 'moves']).default('medicines'),
  q: z.string().trim().max(80).optional(),
  medicineId: IdSchema.optional(),
  /** medicines: low | expiring | expired | ok; batches: in_stock | expiring | expired | empty; moves: received | given | written_off. */
  state: z
    .string()
    .regex(/^[a-z_]{2,20}$/)
    .optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(15),
});
export class StockListDto extends createZodDto(StockListSchema) {}
export const StockExportSchema = StockListSchema.omit({ page: true, size: true });
export class StockExportDto extends createZodDto(StockExportSchema) {}

/** The family's Health list: visits and published cards together, latest first. */
export const MineHealthSchema = z.object({
  studentId: IdSchema.optional(),
  kind: z.enum(['visit', 'card']).optional(),
  q: z.string().trim().max(80).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(50).default(10),
});
export class MineHealthDto extends createZodDto(MineHealthSchema) {}
