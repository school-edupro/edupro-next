import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MobileSchema, SchoolCodeSchema } from '../admissions/admissions.dto';

const Id = z.string().regex(/^\d{1,18}$/);
const Email = z.string().trim().toLowerCase().email().max(200);

/** The address the code goes to: a 10-digit mobile, or an email, as the channel says. */
const toFits = (x: { channel: 'mobile' | 'email'; to: string }, ctx: z.RefinementCtx) => {
  const ok =
    x.channel === 'mobile' ? MobileSchema.safeParse(x.to).success : Email.safeParse(x.to).success;
  if (!ok)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: x.channel === 'mobile' ? 'a 10-digit mobile number' : 'an email address',
    });
};
const Address = {
  schoolCode: SchoolCodeSchema,
  channel: z.enum(['mobile', 'email']),
  to: z.string().trim().toLowerCase().min(5).max(200),
};

/** A code to the mobile or to the email (the candidate chooses), with a solved challenge. */
export const CandidateOtpSchema = z
  .object({
    ...Address,
    challenge: z.string().min(10).max(600),
    nonce: z.string().min(1).max(40),
  })
  .superRefine(toFits);
export class CandidateOtpDto extends createZodDto(CandidateOtpSchema) {}

export const CandidateVerifySchema = z
  .object({
    ...Address,
    code: z.string().regex(/^\d{6}$/),
    name: z.string().trim().max(120).optional(),
  })
  .superRefine(toFits);
export class CandidateVerifyDto extends createZodDto(CandidateVerifySchema) {}

const Cell = z.union([z.string().max(300), z.number(), z.null()]);
const RowList = z.array(z.record(z.string().max(40), Cell)).max(20);
/** The form as it stands: answers, the row lists given, the interests ticked. */
export const CandidateProfileSchema = z.object({
  values: z
    .record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.null()]))
    .default({}),
  rows: z
    .object({
      education: RowList.optional(),
      experience: RowList.optional(),
      training: RowList.optional(),
      children: RowList.optional(),
      references: RowList.optional(),
    })
    .optional(),
  activities: z.array(z.string().max(60)).max(20).optional(),
});
export class CandidateProfileDto extends createZodDto(CandidateProfileSchema) {}

export const CandidateFileSlotSchema = z.object({
  kind: z.string().max(40),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
});
export class CandidateFileSlotDto extends createZodDto(CandidateFileSlotSchema) {}

export const CandidateFileSchema = z.object({ kind: z.string().max(40), fileId: Id });
export class CandidateFileDto extends createZodDto(CandidateFileSchema) {}

export const CandidateApplySchema = z.object({ declaration: z.boolean() });
export class CandidateApplyDto extends createZodDto(CandidateApplySchema) {}
