import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const WORKFLOW = {
  definitionView: 'workflow.definition.view',
  definitionManage: 'workflow.definition.manage',
  inboxAct: 'workflow.inbox.act',
  instanceView: 'workflow.instance.view',
} as const;

export const ResolverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('named_user'), userId: IdSchema }),
  z.object({
    kind: z.literal('role'),
    roleCode: z
      .string()
      .trim()
      .regex(/^[a-z_]{2,40}$/),
  }),
  z.object({ kind: z.literal('position'), designation: z.string().trim().min(2).max(80) }),
  /** The requester's reporting line: level n is the n-th manager above the requesting employee. */
  z.object({ kind: z.literal('approver_chain'), depth: z.number().int().min(1).max(5).default(1) }),
]);
export type Resolver = z.infer<typeof ResolverSchema>;

export const LevelSchema = z.object({
  level: z.number().int().min(1).max(10),
  name: z.string().trim().min(1).max(80),
  resolver: ResolverSchema,
  slaHours: z.number().int().min(1).max(720).optional(),
});

export const CreateDefinitionSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  entityType: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,40}$/),
  levels: z.array(LevelSchema).min(1).max(10),
});
export class CreateDefinitionDto extends createZodDto(CreateDefinitionSchema) {}

export const UpdateDefinitionSchema = CreateDefinitionSchema.omit({ code: true, entityType: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateDefinitionDto extends createZodDto(UpdateDefinitionSchema) {}

export const ActSchema = z.object({ note: z.string().trim().max(500).optional() });
export class ActDto extends createZodDto(ActSchema) {}

export const ListInstancesQuerySchema = z.object({
  entityType: z.string().trim().max(40).optional(),
  entityId: IdSchema.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListInstancesQueryDto extends createZodDto(ListInstancesQuerySchema) {}
