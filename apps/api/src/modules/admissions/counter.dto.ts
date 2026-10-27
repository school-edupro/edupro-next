import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DeskFeeSchema } from './desk.dto';

/** The admission fee counter (docs/design/52, part 2). */
export const CounterQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  /** only registrations with a fee due (the default) */
  due: z.enum(['1', '0']).default('1'),
});
export class CounterQueryDto extends createZodDto(CounterQuerySchema) {}

export const CounterCollectSchema = DeskFeeSchema.extend({
  kind: z.enum(['registration', 'admission']),
});
export class CounterCollectDto extends createZodDto(CounterCollectSchema) {}
