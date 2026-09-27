import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SETTING_KEYS } from './settings.catalogue';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const IdSchema = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');

// ---- settings ------------------------------------------------------------------------------------
export const SetSettingSchema = z.object({
  value: z.unknown(),
  validFrom: DateSchema.optional(),
});
export class SetSettingDto extends createZodDto(SetSettingSchema) {}

export const SettingKeyParam = z.enum(SETTING_KEYS as [string, ...string[]]);

// ---- years ---------------------------------------------------------------------------------------
export const YearStage = z.enum(['attendance', 'exams', 'fees', 'academics']);
export type YearStageType = z.infer<typeof YearStage>;

export const CreateYearSchema = z
  .object({
    kind: z.enum(['academic', 'financial']),
    code: z
      .string()
      .trim()
      .regex(/^(FY)?\d{4}-\d{2}$/, 'YYYY-YY or FYYYYY-YY'),
    name: z.string().trim().min(3).max(60),
    startDate: DateSchema,
    endDate: DateSchema,
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });
export class CreateYearDto extends createZodDto(CreateYearSchema) {}

export const StageSchema = z.object({
  stage: YearStage,
  reason: z.string().trim().min(3).max(500),
});
export class StageDto extends createZodDto(StageSchema) {}

export const CloseYearSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class CloseYearDto extends createZodDto(CloseYearSchema) {}

// ---- school and campuses -------------------------------------------------------------------------
export const UpdateSchoolSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    shortName: z.string().trim().min(1).max(40).nullable(),
    affiliationNo: z.string().trim().max(40).nullable(),
    board: z.enum(['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER']),
    timezone: z.string().trim().min(3).max(64),
    locale: z.string().trim().min(2).max(10),
    address: z.record(z.string(), z.unknown()),
    contact: z.record(z.string(), z.unknown()),
    branding: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateSchoolDto extends createZodDto(UpdateSchoolSchema) {}

export const CampusSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{1,20}$/, 'upper case code'),
  name: z.string().trim().min(2).max(120),
  address: z.record(z.string(), z.unknown()).default({}),
  geo: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
});
export class CreateCampusDto extends createZodDto(CampusSchema) {}

export const UpdateCampusSchema = CampusSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});
export class UpdateCampusDto extends createZodDto(UpdateCampusSchema) {}
