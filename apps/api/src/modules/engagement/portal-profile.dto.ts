import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** Portal profile and profile approvals (2026-10-01). */
export const PORTAL = {
  manage: 'people.portal_profile.manage',
  approve: 'engagement.change_request.approve',
  override: 'engagement.change_request.override',
} as const;

const Level = z.enum(['hidden', 'view', 'edit_approval', 'edit_direct']);
const FieldKey = z.string().regex(/^[a-z0-9_]{2,60}$/);
const Approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('office') }),
  z.object({ kind: z.literal('class_teacher') }),
  z.object({ kind: z.literal('role'), roleId: IdSchema, name: z.string().max(80).optional() }),
  z.object({ kind: z.literal('user'), userId: IdSchema, name: z.string().max(80).optional() }),
]);
const Route = z.array(Approver).min(1).max(2);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const SavePortalPolicySchema = z.object({
  fields: z.object({
    parent: z.record(FieldKey, Level),
    student: z.record(FieldKey, Level),
  }),
  proofs: z.record(FieldKey, z.string().regex(/^[a-z_]{2,40}$/)).default({}),
  window: z
    .object({
      mode: z.enum(['open', 'closed', 'period']),
      from: DateSchema.nullish(),
      to: DateSchema.nullish(),
      message: z.string().trim().max(300).nullish(),
    })
    .refine((w) => w.mode !== 'period' || (w.from && w.to && w.from <= w.to), {
      message: 'An update period needs a start and an end date, the start first',
    }),
  approval: z.object({
    default: Route,
    sections: z.record(z.string().regex(/^[a-z_]{2,40}$/), Route).default({}),
    fields: z.record(FieldKey, Route).default({}),
  }),
});
export class SavePortalPolicyDto extends createZodDto(SavePortalPolicySchema) {}

export const SubmitPortalChangesSchema = z.object({
  changes: z
    .record(FieldKey, z.string().trim().max(300))
    .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 80, {
      message: 'between 1 and 80 changes',
    }),
  reason: z.string().trim().max(500).optional(),
  proofs: z
    .array(z.object({ kind: z.string().regex(/^[a-z_]{2,40}$/), fileId: IdSchema }))
    .max(10)
    .default([]),
});
export class SubmitPortalChangesDto extends createZodDto(SubmitPortalChangesSchema) {}

export const InboxQuerySchema = z.object({
  box: z.enum(['mine', 'all', 'decided']).default('mine'),
  /** Class and section as shown, e.g. VI-A. */
  classSection: z.string().trim().max(40).optional(),
  section: z
    .string()
    .regex(/^[a-z_]{2,40}$/)
    .optional(),
  q: z.string().trim().max(80).optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class InboxQueryDto extends createZodDto(InboxQuerySchema) {}

export const DecideItemsSchema = z
  .object({
    /** Every pending field the same way. */
    approve: z.boolean().optional(),
    /** Field by field: true accepts, false refuses (partial approval). */
    fields: z.record(z.string().min(1).max(60), z.boolean()).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.approve !== undefined || (d.fields && Object.keys(d.fields).length > 0), {
    message: 'approve or fields is required',
  })
  .refine(
    (d) =>
      d.note ||
      (d.approve !== false && !(d.fields && Object.values(d.fields).some((x) => x === false))),
    { message: 'Give a reason when refusing a change', path: ['note'] },
  );
export class DecideItemsDto extends createZodDto(DecideItemsSchema) {}

export const BulkDecideSchema = z
  .object({
    ids: z.array(IdSchema).min(1).max(200),
    approve: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.approve || d.note, {
    message: 'Give a reason when refusing changes',
    path: ['note'],
  });
export class BulkDecideDto extends createZodDto(BulkDecideSchema) {}
