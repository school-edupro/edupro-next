import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The staff app's layout kept by the school (0413, docs/design/94): the bodies of its calls. */
const Path = z.string().trim().min(1).max(40);

export const StaffLayoutSchema = z.object({
  tabs: z.array(Path).max(10),
  shortcuts: z.array(Path).max(30),
  cards: z.array(z.string().trim().min(1).max(40)).max(20),
});
export class StaffLayoutDto extends createZodDto(StaffLayoutSchema) {}

export const StaffShortcutsSchema = z.object({ shortcuts: z.array(Path).min(1).max(30) });
export class StaffShortcutsDto extends createZodDto(StaffShortcutsSchema) {}
