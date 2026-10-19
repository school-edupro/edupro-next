import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Employee self-service profile (0186, docs/design/33-people-dashboards.md). */
const Id = z.string().regex(/^\d{1,18}$/);
const Level = z.enum(['hidden', 'view', 'edit_approval', 'edit_direct']);
const Approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('office') }),
  z.object({ kind: z.literal('hod') }),
  z.object({ kind: z.literal('l1') }),
  z.object({ kind: z.literal('l2') }),
  z.object({ kind: z.literal('role'), roleCode: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal('employee'), employeeId: Id }),
]);
const Route = z.array(Approver).min(1).max(2);
const ListKind = z.enum(['education', 'languages', 'experience', 'training', 'documents']);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EmployeePolicySchema = z.object({
  fields: z.record(z.string().max(60), Level),
  proofs: z.record(z.string().max(60), Id),
  /** 0187: the row lists; approvers for a list go under approval.sections['list:<kind>'] */
  lists: z
    .record(ListKind, z.object({ level: Level, proof: Id.nullable().optional() }))
    .default({}),
  window: z.object({
    mode: z.enum(['open', 'closed', 'period']),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    message: z.string().trim().max(300).nullable().optional(),
  }),
  approval: z.object({
    default: Route,
    sections: z.record(z.string().max(40), Route).default({}),
    fields: z.record(z.string().max(60), Route).default({}),
  }),
});
export class EmployeePolicyDto extends createZodDto(EmployeePolicySchema) {}

/** A document the employee adds from My profile (0187). */
export const EmployeeDocumentRowSchema = z.object({
  typeId: Id,
  fileId: Id,
  number: z.string().trim().max(80).optional(),
  issuedOn: day.optional(),
  expiresOn: day.optional(),
});

/** One row change on a list: add (data), edit (rowId + data) or remove (rowId). */
export const EmployeeRowChangeSchema = z.object({
  kind: ListKind,
  op: z.enum(['add', 'edit', 'remove']),
  rowId: Id.optional(),
  data: z
    .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const EmployeeChangesSchema = z
  .object({
    changes: z
      .record(z.string().max(60), z.union([z.string().max(300), z.boolean(), z.null()]))
      .refine((c) => Object.keys(c).length <= 80, 'change up to 80 fields')
      .default({}),
    /** 0187: row changes on education, languages, experience and documents */
    rows: z.array(EmployeeRowChangeSchema).max(20).default([]),
    /** 0188: a new photo (the employee's own image upload), with approval or at once as the policy says */
    photo: Id.optional(),
    reason: z.string().trim().max(500).nullable().optional(),
    proofs: z
      .array(z.object({ typeId: Id, fileId: Id }))
      .max(10)
      .default([]),
  })
  .refine(
    (d) => Object.keys(d.changes).length + d.rows.length + (d.photo ? 1 : 0) >= 1,
    'change at least one thing',
  );
export class EmployeeChangesDto extends createZodDto(EmployeeChangesSchema) {}

export const StaffInboxSchema = z.object({
  box: z.enum(['mine', 'all', 'decided']).default('mine'),
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(100).default(25),
});
export class StaffInboxDto extends createZodDto(StaffInboxSchema) {}

export const StaffDecideSchema = z
  .object({
    approve: z.boolean().optional(),
    fields: z.record(z.string().max(60), z.boolean()).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => d.approve !== undefined || d.fields, {
    message: 'decide the request or its fields',
  });
export class StaffDecideDto extends createZodDto(StaffDecideSchema) {}

export const StaffBulkSchema = z.object({
  ids: z.array(Id).min(1).max(100),
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
});
export class StaffBulkDto extends createZodDto(StaffBulkSchema) {}
