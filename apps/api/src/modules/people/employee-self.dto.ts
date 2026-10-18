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

export const EmployeePolicySchema = z.object({
  fields: z.record(z.string().max(60), Level),
  proofs: z.record(z.string().max(60), Id),
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

export const EmployeeChangesSchema = z.object({
  changes: z
    .record(z.string().max(60), z.union([z.string().max(300), z.boolean(), z.null()]))
    .refine(
      (c) => Object.keys(c).length >= 1 && Object.keys(c).length <= 80,
      'change one to 80 fields',
    ),
  reason: z.string().trim().max(500).nullable().optional(),
  proofs: z
    .array(z.object({ typeId: Id, fileId: Id }))
    .max(10)
    .default([]),
});
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
