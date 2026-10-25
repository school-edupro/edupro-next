import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const Answers = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.unknown());

export const DeskStartSchema = z
  .object({
    cycleId: IdSchema,
    classId: IdSchema,
    mobile: z
      .string()
      .regex(/^[6-9]\d{9}$/, '10-digit mobile number')
      .optional(),
    email: z.string().email().max(200).optional(),
    parentName: z.string().trim().min(2).max(120).optional(),
  })
  .refine((v) => v.mobile || v.email, { message: 'Give the parent’s mobile number or email' });
export class DeskStartDto extends createZodDto(DeskStartSchema) {}

export const DeskStepSchema = z.object({
  answers: Answers,
  step: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
});
export class DeskStepDto extends createZodDto(DeskStepSchema) {}

export const DeskSubmitSchema = z.object({
  answers: Answers,
  /** an admin lets a second registration of the same child in the year through, with the reason (docs/design/41) */
  duplicateReason: z.string().trim().min(5).max(300).optional(),
});
export class DeskSubmitDto extends createZodDto(DeskSubmitSchema) {}

export const DeskFeeSchema = z.object({
  mode: z.enum(['cash', 'cheque', 'dd', 'upi', 'bank', 'card']),
  reference: z.string().trim().max(80).optional(),
  instrumentNo: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(80).optional(),
  receivedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export class DeskFeeDto extends createZodDto(DeskFeeSchema) {}

export const DeskSlotSchema = z.object({
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
});
export class DeskSlotDto extends createZodDto(DeskSlotSchema) {}

/** Find a registration or an enquiry at the desk (docs/design/45, part 4). */
export const DeskFindSchema = z.object({ q: z.string().trim().min(2).max(80) });
export class DeskFindDto extends createZodDto(DeskFindSchema) {}
