import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../../academics/classes/classes.dto';

const School = z.string().trim().min(2).max(20);
const Answers = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.unknown())
  .refine((v) => Object.keys(v).length <= 300);

export const CodeRequestSchema = z.object({
  schoolCode: School,
  identifier: z.string().trim().min(4).max(120),
  challenge: z.string().min(10).max(400),
  nonce: z.string().min(1).max(40),
});
export class CodeRequestDto extends createZodDto(CodeRequestSchema) {}

export const CodeVerifySchema = z.object({
  schoolCode: School,
  identifier: z.string().trim().min(4).max(120),
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().max(120).optional(),
});
export class CodeVerifyDto extends createZodDto(CodeVerifySchema) {}

export const StartSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  /** the invitation of an enquiry (docs/design/39, part 8) */
  enquiry: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
  /** a new form on purpose (another child), instead of the family's draft for the class (docs/design/41) */
  another: z.boolean().optional(),
});
export class StartDto extends createZodDto(StartSchema) {}

export const SaveStepSchema = z.object({
  answers: Answers,
  step: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
});
export class SaveStepDto extends createZodDto(SaveStepSchema) {}

export const SubmitFormSchema = z.object({ answers: Answers });
export class SubmitFormDto extends createZodDto(SubmitFormSchema) {}

export const PaySchema = z.object({ gatewayId: IdSchema.optional() });
export class PayDto extends createZodDto(PaySchema) {}

export const SlotSchema = z.object({
  applicationId: IdSchema,
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
});
export class SlotDto extends createZodDto(SlotSchema) {}

export const WithdrawSchema = z.object({ reason: z.string().trim().max(300).optional() });
export class WithdrawDto extends createZodDto(WithdrawSchema) {}

/** A late-entry passcode as the family types it (ABCD-EFGH, case and dashes free). */
export const PasscodeUseSchema = z.object({ code: z.string().trim().min(8).max(20) });
export class PasscodeUseDto extends createZodDto(PasscodeUseSchema) {}
