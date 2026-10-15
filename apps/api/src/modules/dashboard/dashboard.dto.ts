import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const Keys = z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(40);
const Hrefs = z.array(z.string().regex(/^\/[A-Za-z0-9/_?=&.-]{0,200}$/)).max(40);

export const LayoutSchema = z.object({
  widgets: Keys,
  hidden: Keys.default([]),
  quickActions: Hrefs.default([]),
});
export class LayoutDto extends createZodDto(LayoutSchema) {}

export const DefaultsSchema = z.object({ widgets: Keys, quickActions: Hrefs.default([]) });
export class DefaultsDto extends createZodDto(DefaultsSchema) {}

export const WishSchema = z.object({
  kind: z.enum(['student', 'employee']),
  id: IdSchema,
  message: z.string().trim().max(300).optional(),
});
export class WishDto extends createZodDto(WishSchema) {}
