import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** The rebuilt mess (0161): school meals, the rotating menu, diets, the meal register, head count, feedback. */
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Format = z.enum(['xlsx', 'pdf']).default('xlsx');
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

// ---- meals of the school ------------------------------------------------------------------------------------
export const MessMealSchema = z.object({
  name: z.string().trim().min(1).max(40),
  atTime: TimeSchema,
  active: z.boolean().default(true),
  /** The hostels that serve it; a hostel may keep its own time. */
  hostels: z
    .array(z.object({ hostelId: IdSchema, atTime: TimeSchema.nullable().optional() }))
    .max(50),
});
export class MessMealDto extends createZodDto(MessMealSchema) {}
export const MealOrderSchema = z.object({ ids: z.array(IdSchema).min(1).max(30) });
export class MealOrderDto extends createZodDto(MealOrderSchema) {}

// ---- the rotating menu --------------------------------------------------------------------------------------
export const MenuCycleSchema = z.object({
  hostelId: IdSchema,
  weeks: z.number().int().min(1).max(4),
  /** The Monday week 1 starts on. */
  start: DateSchema,
});
export class MenuCycleDto extends createZodDto(MenuCycleSchema) {}

export const MenuTemplateQuerySchema = z.object({
  hostelId: IdSchema,
  week: z.coerce.number().int().min(1).max(4).default(1),
});
export class MenuTemplateQueryDto extends createZodDto(MenuTemplateQuerySchema) {}

export const MenuCloneSchema = z.object({
  fromHostelId: IdSchema,
  toHostelIds: z.array(IdSchema).min(1).max(50),
  /** replace: the target's menu becomes the source's; fill: only empty cells are filled. */
  mode: z.enum(['replace', 'fill']),
});
export class MenuCloneDto extends createZodDto(MenuCloneSchema) {}

export const MenuCopySchema = z
  .object({
    hostelId: IdSchema,
    fromWeek: z.number().int().min(1).max(4),
    /** A day of the week (0 = Sunday); none = the whole cycle week. */
    fromWeekday: z.number().int().min(0).max(6).nullable().optional(),
    to: z
      .array(
        z.object({
          week: z.number().int().min(1).max(4),
          weekday: z.number().int().min(0).max(6).nullable().optional(),
        }),
      )
      .min(1)
      .max(28),
  })
  .refine(
    (v) => v.to.every((t) => (t.weekday ?? null) === null) === ((v.fromWeekday ?? null) === null),
    { message: 'Copy a day to days, or a week to weeks', path: ['to'] },
  );
export class MenuCopyDto extends createZodDto(MenuCopySchema) {}

export const MenuFileSchema = z.object({
  hostelId: IdSchema,
  weekOf: DateSchema.optional(),
  format: Format,
});
export class MenuFileDto extends createZodDto(MenuFileSchema) {}

// ---- diet types, allergies, the diet list ---------------------------------------------------------------------
export const DietTypesSchema = z.object({
  types: z
    .array(
      z.object({
        id: IdSchema.optional(),
        code: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z][a-z0-9_]{0,29}$/, 'small letters, digits or _'),
        name: z.string().trim().min(1).max(40),
        active: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(30)
    .refine((t) => t.filter((x) => x.isDefault && x.active).length === 1, {
      message: 'Mark one diet in use as the default',
    })
    .refine((t) => new Set(t.map((x) => x.code)).size === t.length, {
      message: 'Each diet needs its own code',
    }),
  allergies: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(1).max(40),
        active: z.boolean().default(true),
      }),
    )
    .max(60),
});
export class DietTypesDto extends createZodDto(DietTypesSchema) {}

export const DietListSchema = z.object({
  hostelId: IdSchema.optional(),
  diet: z.string().trim().max(30).optional(),
  allergy: z.string().trim().max(40).optional(),
  /** set: diets the hostel recorded; unset: boarders on the default. */
  set: z.enum(['set', 'unset']).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(200).default(25),
});
export class DietListDto extends createZodDto(DietListSchema) {}
export const DietFileSchema = DietListSchema.omit({ page: true, size: true }).extend({
  format: Format,
});
export class DietFileDto extends createZodDto(DietFileSchema) {}
export const DietUploadSchema = z.object({ fileBase64: z.string().min(10).max(8_000_000) });
export class DietUploadDto extends createZodDto(DietUploadSchema) {}

// ---- the meal register, head count, feedback ----------------------------------------------------------------
export const MealRegisterSchema = z.object({ hostelId: IdSchema.optional(), month: MonthSchema });
export class MealRegisterDto extends createZodDto(MealRegisterSchema) {}
export const MealRegisterFileSchema = MealRegisterSchema.extend({ format: Format });
export class MealRegisterFileDto extends createZodDto(MealRegisterFileSchema) {}

export const HeadcountSchema = z.object({
  on: DateSchema.optional(),
  hostelId: IdSchema.optional(),
});
export class HeadcountDto extends createZodDto(HeadcountSchema) {}
export const HeadcountFileSchema = HeadcountSchema.extend({ format: Format });
export class HeadcountFileDto extends createZodDto(HeadcountFileSchema) {}

export const FeedbackSchema = z.object({
  studentId: IdSchema,
  mealId: IdSchema,
  onDate: DateSchema,
  rating: z.number().int().min(1).max(5),
  comment: Optional(500),
});
export class FeedbackDto extends createZodDto(FeedbackSchema) {}
export const FeedbackQuerySchema = z.object({
  hostelId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class FeedbackQueryDto extends createZodDto(FeedbackQuerySchema) {}
