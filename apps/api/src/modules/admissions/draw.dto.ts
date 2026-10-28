import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';
import { SLIP_FIELDS } from './draw-slips-pdf';
import { OfferMessageSchema } from './process.dto';

/** A draw's group: a session, a class and (optionally) a category (docs/design/60). */
const PlaceSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  categoryId: IdSchema.optional(),
});
export class DrawPlaceDto extends createZodDto(PlaceSchema) {}

/** One total of the form's merit points (test and interview marks not added, docs/design/62). */
const Points = z.string().regex(/^-?\d{1,7}(\.\d{1,2})?$/, 'A points total');
export const DrawGroupSchema = PlaceSchema.extend({ points: Points });
export class DrawGroupDto extends createZodDto(DrawGroupSchema) {}

/** Twins confirmed on one slip, or split onto a slip each. */
export const DrawTwinsSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  ids: z.array(IdSchema).min(2).max(4),
  state: z.enum(['paired', 'split']),
});
export class DrawTwinsDto extends createZodDto(DrawTwinsSchema) {}

/** The slips' settings of a session, or a class's own. */
export const DrawSettingsQuerySchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema.optional(),
});
export class DrawSettingsQueryDto extends createZodDto(DrawSettingsQuerySchema) {}
export const DrawSettingsSchema = DrawSettingsQuerySchema.extend({
  heading: z.string().trim().min(1).max(160),
  fields: z
    .array(z.enum(SLIP_FIELDS))
    .max(SLIP_FIELDS.length)
    .refine((f) => new Set(f).size === f.length, 'Each detail once'),
  drawAt: z.string().datetime({ offset: true }).nullable(),
  venue: z.string().trim().max(160).nullable(),
  footer: z.string().trim().max(300).nullable(),
  perPage: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]),
  showLogo: z.boolean(),
});
export class DrawSettingsDto extends createZodDto(DrawSettingsSchema) {}

/**
 * A draw made by hand with the slips (docs/design/60, part 3): the registration numbers in the order
 * drawn (a twin slip by either number); the first `seats` offered, the rest wait-listed in order.
 */
export const DrawRecordSchema = DrawGroupSchema.extend({
  seats: z.number().int().min(1).max(5000),
  numbers: z.array(z.string().trim().max(60)).min(1).max(5000),
  offerMessage: OfferMessageSchema.optional(),
});
export class DrawRecordDto extends createZodDto(DrawRecordSchema) {}
export const DrawRecordsQuerySchema = z.object({ cycleId: IdSchema, classId: IdSchema });
export class DrawRecordsQueryDto extends createZodDto(DrawRecordsQuerySchema) {}

/** Blank slips in the class's layout, to fill by hand (docs/design/62). */
export const DrawBlankSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  pages: z.coerce.number().int().min(1).max(20).default(1),
});
export class DrawBlankDto extends createZodDto(DrawBlankSchema) {}
