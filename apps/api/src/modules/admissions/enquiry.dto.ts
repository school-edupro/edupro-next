import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Mobile = z.string().regex(/^[6-9]\d{9}$/, '10-digit mobile number');
const STATUS = ['new', 'follow_up', 'interested', 'converted', 'not_interested', 'closed'] as const;

const EnquiryBase = z.object({
  cycleId: IdSchema.nullable().optional(),
  classId: IdSchema.nullable().optional(),
  sourceId: IdSchema.nullable().optional(),
  campaign: z.string().trim().max(80).nullable().optional(),
  parentName: z.string().trim().min(2).max(120),
  childName: z.string().trim().max(120).nullable().optional(),
  childDob: DateSchema.nullable().optional(),
  mobile: Mobile.nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  previousSchool: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  counsellorUserId: IdSchema.nullable().optional(),
  nextFollowUpOn: DateSchema.nullable().optional(),
});
export const EnquirySchema = EnquiryBase.refine((v) => Boolean(v.mobile || v.email), {
  message: 'Give the mobile or the email',
  path: ['mobile'],
});
export class EnquiryDto extends createZodDto(EnquirySchema) {}

export const EnquiryUpdateSchema = EnquiryBase.extend({ status: z.enum(STATUS).optional() }).refine(
  (v) => Boolean(v.mobile || v.email),
  { message: 'Give the mobile or the email', path: ['mobile'] },
);
export class EnquiryUpdateDto extends createZodDto(EnquiryUpdateSchema) {}

export const EnquiryQuerySchema = z.object({
  status: z.enum([...STATUS, 'open']).optional(),
  sourceId: IdSchema.optional(),
  classId: IdSchema.optional(),
  cycleId: IdSchema.optional(),
  counsellor: z.union([z.literal('me'), z.literal('none'), IdSchema]).optional(),
  due: z.enum(['today', 'overdue', 'upcoming']).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class EnquiryQueryDto extends createZodDto(EnquiryQuerySchema) {}

export const FollowUpSchema = z.object({
  mode: z.enum(['call', 'visit', 'email', 'sms', 'whatsapp', 'note']),
  outcome: z.string().trim().min(2).max(1000),
  nextOn: DateSchema.nullable().optional(),
  status: z.enum(['follow_up', 'interested', 'not_interested', 'closed']).optional(),
});
export class FollowUpDto extends createZodDto(FollowUpSchema) {}

export const InviteSchema = z.object({
  cycleId: IdSchema.optional(),
  message: z.string().trim().max(500).optional(),
});
export class InviteDto extends createZodDto(InviteSchema) {}

/** A reply to the family from the enquiry (docs/design/43, part 3): by email and / or SMS. */
export const ReplySchema = z
  .object({
    message: z.string().trim().min(2).max(1000),
    email: z.boolean().default(true),
    mobile: z.boolean().default(true),
  })
  .refine((v) => v.email || v.mobile, { message: 'Choose email or SMS', path: ['email'] });
export class ReplyDto extends createZodDto(ReplySchema) {}

/** How the desk takes website enquiries: assigned on arrival, to whom, acknowledged. */
export const EnquiryDeskSchema = z.object({
  autoAssign: z.boolean(),
  counsellors: z.array(IdSchema).max(100),
  acknowledge: z.boolean(),
});
export class EnquiryDeskDto extends createZodDto(EnquiryDeskSchema) {}

export const SourcesSchema = z.object({
  sources: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(2).max(60),
        status: z.enum(['active', 'inactive']).default('active'),
      }),
    )
    .min(1)
    .max(40),
});
export class SourcesDto extends createZodDto(SourcesSchema) {}

export const EnquiryReportQuerySchema = z.object({
  cycleId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class EnquiryReportQueryDto extends createZodDto(EnquiryReportQuerySchema) {}

/** The enquiry form on the school's website (anonymous; a proof-of-work first). */
export const PublicEnquirySchema = z
  .object({
    schoolCode: z.string().trim().min(2).max(20),
    challenge: z.string().min(8).max(200),
    nonce: z.string().min(1).max(40),
    parentName: z.string().trim().min(2).max(120),
    childName: z.string().trim().max(120).optional(),
    childDob: DateSchema.optional(),
    classId: IdSchema.optional(),
    mobile: Mobile.optional(),
    email: z.string().trim().email().max(200).optional(),
    locality: z.string().trim().max(120).optional(),
    message: z.string().trim().max(1000).optional(),
  })
  .refine((v) => Boolean(v.mobile || v.email), {
    message: 'Give the mobile or the email',
    path: ['mobile'],
  });
export class PublicEnquiryDto extends createZodDto(PublicEnquirySchema) {}
