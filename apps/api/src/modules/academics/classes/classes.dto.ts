import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Ids travel as numeric strings to avoid JavaScript precision loss on BIGINT (design section 10). */
export const IdSchema = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');

export const RowStatusSchema = z.enum(['active', 'inactive']);

export const ClassSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  displayOrder: z.number().int(),
  status: RowStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ClassRow = z.infer<typeof ClassSchema>;

export const CreateClassSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
});
export class CreateClassDto extends createZodDto(CreateClassSchema) {}

export const UpdateClassSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(100),
    displayOrder: z.number().int().min(0).max(10_000),
    status: RowStatusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateClassDto extends createZodDto(UpdateClassSchema) {}

export const ListClassesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  status: RowStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export class ListClassesQueryDto extends createZodDto(ListClassesQuerySchema) {}

export const ClassSectionSchema = z.object({
  id: IdSchema,
  academicYearId: IdSchema,
  classId: IdSchema,
  campusId: IdSchema.nullable(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  status: RowStatusSchema,
});
export type ClassSectionRow = z.infer<typeof ClassSectionSchema>;

export const CreateClassSectionSchema = z.object({
  name: z.string().trim().min(1).max(10),
  capacity: z.number().int().min(1).max(500).optional(),
  campusId: IdSchema.optional(),
});
export class CreateClassSectionDto extends createZodDto(CreateClassSectionSchema) {}

export interface Page<T> {
  data: T[];
  page: { number: number; size: number; total: number };
}
