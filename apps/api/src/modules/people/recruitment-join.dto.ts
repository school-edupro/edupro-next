import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const txt = (n: number) => z.string().trim().max(n);

/** The move of a selected candidate to the employee master: the employment and the documents to copy. */
export const JoinSchema = z.object({
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeCode: txt(30).min(1).optional(),
  department: txt(80).optional(),
  designation: txt(80).optional(),
  employeeType: txt(80).optional(),
  natureOfAppointment: txt(80).optional(),
  createLogin: z.boolean().default(true),
  /** each candidate document (its id on the application) and the employee document type it becomes */
  documents: z
    .array(z.object({ id: Id, typeId: Id.nullable() }))
    .max(40)
    .default([]),
  /** the office confirms the employee with the same mobile, email or ID is a different person */
  confirmMatch: z.boolean().default(false),
});
export class JoinDto extends createZodDto(JoinSchema) {}
