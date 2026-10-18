import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Employee ACR (0184, docs/design/32-employee-acr.md). */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Id = z.string().regex(/^\d{1,18}$/);
const Group = z.enum(['teaching', 'non_teaching']);

export const AcrSettingsSchema = z.object({
  scaleLabels: z.array(z.string().trim().min(1).max(40)).min(3).max(10),
  representationDays: z.number().int().min(0).max(90),
  bands: z
    .array(
      z.object({
        minPct: z.number().min(0).max(100),
        label: z.string().trim().min(1).max(40),
        adverse: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(10),
});
export class AcrSettingsDto extends createZodDto(AcrSettingsSchema) {}

export const AcrLevelsSchema = z.object({
  staffGroup: Group,
  levels: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(60),
        kind: z.enum([
          'acr_hod',
          'approver_l1',
          'approver_l2',
          'approver_l3',
          'role',
          'designation',
          'employee',
        ]),
        roleCode: z.string().trim().max(60).nullable().optional(),
        designation: z.string().trim().max(80).nullable().optional(),
        employeeId: Id.nullable().optional(),
        action: z.enum(['rate', 'review']),
      }),
    )
    .min(1)
    .max(6),
});
export class AcrLevelsDto extends createZodDto(AcrLevelsSchema) {}

export const AcrQuestionSchema = z.object({
  part: z.enum(['self', 'rate']),
  staffGroup: z.enum(['teaching', 'non_teaching', 'both']),
  section: z.string().trim().min(2).max(80),
  text: z.string().trim().min(3).max(300),
  kind: z.enum(['scale', 'text']),
  weight: z.number().min(0.25).max(10).default(1),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});
export class AcrQuestionDto extends createZodDto(AcrQuestionSchema) {}

export const AcrCycleSchema = z
  .object({
    academicYearId: Id,
    name: z.string().trim().min(3).max(80),
    selfFrom: Day,
    selfTo: Day,
    reviewBy: Day.nullable().optional(),
  })
  .refine((c) => c.selfTo >= c.selfFrom, {
    message: 'the window ends before it starts',
    path: ['selfTo'],
  });
export class AcrCycleDto extends createZodDto(AcrCycleSchema) {}
