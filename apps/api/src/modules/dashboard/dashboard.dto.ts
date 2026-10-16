import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const Keys = z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(40);
/** a page of the admin app */
const Internal = z.string().regex(/^\/[A-Za-z0-9/_?=&.-]{0,200}$/);
/** a page of the school outside EduPro */
const External = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/[^\s"'<>]+$/, 'A link must start with https://');
const Hrefs = z.array(z.union([Internal, External])).max(40);

export const LayoutSchema = z.object({
  widgets: Keys,
  hidden: Keys.default([]),
  quickActions: Hrefs.default([]),
});
export class LayoutDto extends createZodDto(LayoutSchema) {}

const QuickItem = z.union([
  Internal,
  z.object({
    href: Internal,
    label: z.string().trim().max(40).optional(),
    icon: z
      .string()
      .regex(/^[A-Za-z]{2,20}$/)
      .optional(),
  }),
  z.object({
    href: External,
    label: z.string().trim().min(2).max(40),
    icon: z
      .string()
      .regex(/^[A-Za-z]{2,20}$/)
      .optional(),
  }),
]);

const WidgetSetting = z.object({
  title: z.string().trim().max(40).optional(),
  size: z.enum(['normal', 'wide']).optional(),
  days: z.number().int().min(1).max(31).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

export const DefaultsSchema = z.object({
  widgets: Keys,
  quickActions: z.array(QuickItem).max(24).default([]),
  settings: z.record(z.string().regex(/^[a-z_]{2,40}$/), WidgetSetting).default({}),
  locked: z.boolean().default(false),
});
export class DefaultsDto extends createZodDto(DefaultsSchema) {}

export const CopySchema = z.object({ from: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/) });
export class CopyDto extends createZodDto(CopySchema) {}

export const WishSchema = z.object({
  kind: z.enum(['student', 'employee']),
  id: IdSchema,
  message: z.string().trim().max(300).optional(),
});
export class WishDto extends createZodDto(WishSchema) {}
