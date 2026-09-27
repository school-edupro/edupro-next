import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const TRANSPORT = {
  routeView: 'transport.route.view',
  routeManage: 'transport.route.manage',
} as const;

export const CreateRouteSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  vehicleNo: z.string().trim().max(20).optional(),
  driverName: z.string().trim().max(80).optional(),
  driverMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'a 10-digit Indian mobile')
    .optional(),
});
export class CreateRouteDto extends createZodDto(CreateRouteSchema) {}
export const UpdateRouteSchema = CreateRouteSchema.omit({ code: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial();
export class UpdateRouteDto extends createZodDto(UpdateRouteSchema) {}

export const AssignStudentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        studentId: IdSchema,
        stopName: z.string().trim().max(80).optional(),
        pickupTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        dropTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});
export class AssignStudentsDto extends createZodDto(AssignStudentsSchema) {}
