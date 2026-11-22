import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The staff app's layout kept by the school (0413, docs/design/94): the bodies of its calls. */
const Path = z.string().trim().min(1).max(40);

const GroupName = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const StaffLayoutSchema = z.object({
  tabs: z.array(Path).max(10),
  shortcuts: z.array(Path).max(30),
  cards: z.array(z.string().trim().min(1).max(40)).max(20),
  // the staff website's side menu and the app's More: groups in order, renamed or not, with their screens
  menu: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        label: GroupName,
        labelHi: GroupName,
        items: z.array(Path).max(60),
        hidden: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
  // screens hidden from staff (left out of every menu; their pages still open from a link)
  hidden: z.array(Path).max(80).optional(),
});
export class StaffLayoutDto extends createZodDto(StaffLayoutSchema) {}

export const StaffShortcutsSchema = z.object({ shortcuts: z.array(Path).min(1).max(30) });
export class StaffShortcutsDto extends createZodDto(StaffShortcutsSchema) {}
