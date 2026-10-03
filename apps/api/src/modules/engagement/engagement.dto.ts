import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const ENGAGEMENT = {
  queryView: 'engagement.query.view',
  queryRespond: 'engagement.query.respond',
  queryCreate: 'engagement.query.create',
  feedbackView: 'engagement.feedback.view',
  feedbackCreate: 'engagement.feedback.create',
  changeView: 'engagement.change_request.view',
  changeDecide: 'engagement.change_request.decide',
  changeCreate: 'engagement.change_request.create',
  familyView: 'engagement.family.view',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** Query categories and who answers them; a school may override the table, these are the defaults. */
export const DEFAULT_QUERY_CATEGORIES: Array<{ code: string; name: string; routeTo: string }> = [
  { code: 'academics', name: 'Academics and homework', routeTo: 'class_teacher' },
  { code: 'attendance', name: 'Attendance and leave', routeTo: 'class_teacher' },
  { code: 'fees', name: 'Fees and payments', routeTo: 'accountant' },
  { code: 'transport', name: 'Transport', routeTo: 'school_admin' },
  { code: 'admin', name: 'Office and documents', routeTo: 'school_admin' },
  { code: 'other', name: 'Other', routeTo: 'school_admin' },
];

export const CreateQuerySchema = z
  .object({
    studentId: IdSchema,
    kind: z.enum(['query', 'complaint', 'leave']).default('query'),
    categoryCode: z.string().trim().min(2).max(40).default('other'),
    subject: z.string().trim().min(3).max(160),
    body: z.string().trim().min(1).max(4000),
    fileIds: z.array(IdSchema).max(5).default([]),
    leaveFrom: DateSchema.optional(),
    leaveTo: DateSchema.optional(),
  })
  .refine((v) => v.kind !== 'leave' || (v.leaveFrom && v.leaveTo && v.leaveTo >= v.leaveFrom), {
    message: 'a leave request needs leaveFrom and leaveTo',
    path: ['leaveFrom'],
  });
export class CreateQueryDto extends createZodDto(CreateQuerySchema) {}

export const ListQueriesSchema = z.object({
  /** `active` = everything not closed. */
  status: z.enum(['open', 'in_progress', 'answered', 'closed', 'active']).optional(),
  kind: z.enum(['query', 'complaint', 'leave']).optional(),
  categoryCode: z.string().trim().max(40).optional(),
  studentId: IdSchema.optional(),
  /** Number or subject contains. */
  q: z.string().trim().max(80).optional(),
  /** `latest` = newest first; the default keeps the open ones on top. */
  order: z.enum(['open_first', 'latest']).default('open_first'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListQueriesDto extends createZodDto(ListQueriesSchema) {}

export const RespondSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().default(false),
  fileIds: z.array(IdSchema).max(5).default([]),
});
export class RespondDto extends createZodDto(RespondSchema) {}
export const CloseSchema = z.object({
  decision: z.enum(['approved', 'rejected']).optional(),
  note: z.string().trim().max(1000).optional(),
});
export class CloseDto extends createZodDto(CloseSchema) {}
export const AssignSchema = z.object({ userId: IdSchema.nullable() });
export class AssignDto extends createZodDto(AssignSchema) {}
export const RateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export class RateDto extends createZodDto(RateSchema) {}

export const FEEDBACK_CATEGORIES = [
  'teaching',
  'transport',
  'fees',
  'facilities',
  'communication',
  'app',
] as const;
export const CreateFeedbackSchema = z.object({
  studentId: IdSchema.optional(),
  category: z.enum(FEEDBACK_CATEGORIES),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});
export class CreateFeedbackDto extends createZodDto(CreateFeedbackSchema) {}
export const ListFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListFeedbackDto extends createZodDto(ListFeedbackSchema) {}

/** Fields a family may ask to change; everything else goes through the office. */
export const CHANGEABLE: Record<'student' | 'guardian', string[]> = {
  student: [
    'blood_group',
    'house',
    'address.line1',
    'address.line2',
    'address.city',
    'address.pin',
    'details.emergency_contact',
  ],
  guardian: [
    'mobile',
    'email',
    'occupation',
    'address.line1',
    'address.line2',
    'address.city',
    'address.pin',
  ],
};
export const CreateChangeRequestSchema = z.object({
  studentId: IdSchema,
  /** `profile` = catalogue fields of the student 360 profile (FAMILY_EDITABLE_KEYS). */
  entity: z.enum(['student', 'guardian', 'profile']),
  entityId: IdSchema.optional(),
  changes: z
    .record(z.string().min(1).max(60), z.string().trim().max(300))
    .refine((v) => Object.keys(v).length > 0, { message: 'at least one change' }),
  reason: z.string().trim().max(500).optional(),
});
export class CreateChangeRequestDto extends createZodDto(CreateChangeRequestSchema) {}
export { DecideItemsSchema as DecideChangeSchema } from './portal-profile.dto';
export { DecideItemsDto as DecideChangeDto } from './portal-profile.dto';
export const ListChangeRequestsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'partially_approved', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListChangeRequestsDto extends createZodDto(ListChangeRequestsSchema) {}

// ---- Sprint 11: DPDP privacy notice and onboarding -----------------------------------------------------
export const PublishNoticeSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(20000),
  bodyHi: z.string().trim().max(20000).optional(),
});
export class PublishNoticeDto extends createZodDto(PublishNoticeSchema) {}
export const AcknowledgeSchema = z.object({
  version: z.number().int().min(1),
  consents: z
    .array(
      z.object({
        purposeCode: z.string().trim().min(2).max(60),
        status: z.enum(['granted', 'withdrawn']),
      }),
    )
    .max(20)
    .default([]),
});
export class AcknowledgeDto extends createZodDto(AcknowledgeSchema) {}
export const PRIVACY = { manage: 'platform.privacy.manage' } as const;
