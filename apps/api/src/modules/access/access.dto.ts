import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const IdSchema = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const PermissionCode = z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);

// ---- roles ---------------------------------------------------------------------------------------
export const CreateRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lower snake case, 2 to 40 characters'),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['global', 'module']).default('module'),
  description: z.string().trim().max(500).default(''),
  permissions: z.array(PermissionCode).max(500).default([]),
  copyFromRoleId: IdSchema.optional(),
});
export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}

export const UpdateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    permissions: z.array(PermissionCode).max(500),
    status: z.enum(['active', 'inactive']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}

// ---- assignments ---------------------------------------------------------------------------------
export const ScopeSchema = z.object({
  type: z.enum(['class_section', 'subject', 'department', 'route', 'campus']),
  id: IdSchema,
});

export const GrantSchema = z.object({
  userId: IdSchema,
  roleId: IdSchema,
  campusId: IdSchema.optional(),
  validFrom: DateSchema.optional(),
  validTo: DateSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  scopes: z.array(ScopeSchema).max(200).default([]),
});
export class GrantDto extends createZodDto(GrantSchema) {}

export const RevokeSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class RevokeDto extends createZodDto(RevokeSchema) {}

export const UpdateAssignmentSchema = z.object({
  validTo: DateSchema.nullable().optional(),
  campusId: IdSchema.nullable().optional(),
});
export class UpdateAssignmentDto extends createZodDto(UpdateAssignmentSchema) {}

export const SetScopesSchema = z.object({ scopes: z.array(ScopeSchema).max(200) });
export class SetScopesDto extends createZodDto(SetScopesSchema) {}

export const ListAssignmentsQuerySchema = z.object({
  userId: IdSchema.optional(),
  roleId: IdSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListAssignmentsQueryDto extends createZodDto(ListAssignmentsQuerySchema) {}

// ---- delegations ---------------------------------------------------------------------------------
export const CreateDelegationSchema = z
  .object({
    toUserId: IdSchema,
    roleId: IdSchema,
    /** Only holders of access.delegation.manage may delegate on behalf of another giver. */
    fromUserId: IdSchema.optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine(
    (v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 90 * 24 * 3600 * 1000,
    {
      message: 'a delegation may not exceed 90 days',
      path: ['endsAt'],
    },
  );
export class CreateDelegationDto extends createZodDto(CreateDelegationSchema) {}

// ---- memberships ---------------------------------------------------------------------------------
export const InviteSchema = z
  .object({
    oneauthSub: z.string().trim().min(1).max(200).optional(),
    mobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, '10-digit Indian mobile number')
      .optional(),
    email: z.string().trim().email().optional(),
    displayName: z.string().trim().min(2).max(120),
    personType: z.enum(['employee', 'guardian', 'student', 'external']),
    /** Optional initial role to grant with the invitation. */
    roleId: IdSchema.optional(),
  })
  .refine((v) => v.oneauthSub || v.mobile, {
    message: 'oneauthSub or mobile is required',
    path: ['mobile'],
  });
export class InviteDto extends createZodDto(InviteSchema) {}

export const MembershipStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export class MembershipStatusDto extends createZodDto(MembershipStatusSchema) {}

export const ListMembershipsQuerySchema = z.object({
  personType: z.enum(['employee', 'guardian', 'student', 'external']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListMembershipsQueryDto extends createZodDto(ListMembershipsQuerySchema) {}

export const UserSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
export class UserSearchQueryDto extends createZodDto(UserSearchQuerySchema) {}

// ---- impersonation and break glass (Sprint 5) ----------------------------------------------------
export const StartImpersonationSchema = z.object({
  userId: IdSchema,
  reason: z.string().trim().min(10).max(500),
  minutes: z.number().int().min(5).max(240).default(30),
});
export class StartImpersonationDto extends createZodDto(StartImpersonationSchema) {}

export const BreakGlassSchema = z.object({
  reason: z.string().trim().min(20).max(1000),
  roleCode: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .default('school_admin'),
  hours: z.number().int().min(1).max(4).default(4),
});
export class BreakGlassDto extends createZodDto(BreakGlassSchema) {}
