import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The family app's layout kept by the school (0407, docs/design/90): the bodies and queries of its calls. */

const Path = z.string().trim().min(1).max(40);

const GroupName = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const FamilyLayoutSchema = z.object({
  tabs: z.array(Path).max(10),
  shortcuts: z.array(Path).max(30),
  cards: z.array(z.string().trim().min(1).max(40)).max(20),
  academics: z.array(Path).max(30),
  // the website's side menu and the app's More: groups in order, renamed or not, with their screens
  menu: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        label: GroupName,
        labelHi: GroupName,
        items: z.array(Path).max(40),
        // the whole group hidden from families
        hidden: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
  // screens hidden from families (app and website)
  hidden: z.array(Path).max(40).optional(),
});
export class FamilyLayoutDto extends createZodDto(FamilyLayoutSchema) {}

export const FamilyAudienceSchema = z.enum(['student', 'parent']);

export const FamilyLayoutKindSchema = z.object({ kind: FamilyAudienceSchema.default('parent') });
export class FamilyLayoutKindDto extends createZodDto(FamilyLayoutKindSchema) {}

export const FamilyShortcutsSchema = z.object({ shortcuts: z.array(Path).min(1).max(30) });
export class FamilyShortcutsDto extends createZodDto(FamilyShortcutsSchema) {}
