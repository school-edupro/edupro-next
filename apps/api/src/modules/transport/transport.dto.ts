import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const TRANSPORT = {
  routeView: 'transport.route.view',
  routeManage: 'transport.route.manage',
  fleetView: 'transport.fleet.view',
  fleetManage: 'transport.fleet.manage',
  /** Sprint 13 */
  requestCreate: 'transport.request.create',
  requestView: 'transport.request.view',
  requestDecide: 'transport.request.decide',
  requestApply: 'transport.request.apply',
  setup: 'transport.setup.manage',
  logView: 'transport.log.view',
  logManage: 'transport.log.manage',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const Mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'a 10-digit Indian mobile');

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
  .extend({
    status: z.enum(['active', 'inactive']),
    alertBoarding: z.boolean(),
    alertAlighting: z.boolean(),
    lateAfter: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    /** Sprint 12: fleet links; null clears */
    vehicleId: IdSchema.nullable(),
    driverId: IdSchema.nullable(),
    conductorName: z.string().trim().max(80).nullable(),
    conductorMobile: Mobile.nullable(),
  })
  .partial();
export class UpdateRouteDto extends createZodDto(UpdateRouteSchema) {}

export const AssignStudentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        studentId: IdSchema,
        /** Sprint 12: a stop of the route; its name and times fill the assignment when not given */
        stopId: IdSchema.optional(),
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

// ---- Sprint 12: fleet -------------------------------------------------------------------------------
export const UpsertVehicleSchema = z.object({
  regNo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{4,16}$/, 'registration like MH12AB1234'),
  make: z.string().trim().max(60).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  insuranceExpiry: DateSchema.optional(),
  fitnessExpiry: DateSchema.optional(),
  permitExpiry: DateSchema.optional(),
  gpsDeviceId: z.string().trim().max(60).optional(),
});
export class UpsertVehicleDto extends createZodDto(UpsertVehicleSchema) {}
export const UpdateVehicleSchema = UpsertVehicleSchema.omit({ regNo: true })
  .extend({
    insuranceExpiry: DateSchema.nullable(),
    fitnessExpiry: DateSchema.nullable(),
    permitExpiry: DateSchema.nullable(),
    status: z.enum(['active', 'inactive']),
  })
  .partial();
export class UpdateVehicleDto extends createZodDto(UpdateVehicleSchema) {}

export const UpsertDriverSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: Mobile.optional(),
  licenceNo: z.string().trim().max(30).optional(),
  licenceExpiry: DateSchema.optional(),
  employeeId: IdSchema.optional(),
});
export class UpsertDriverDto extends createZodDto(UpsertDriverSchema) {}
export const UpdateDriverSchema = UpsertDriverSchema.omit({ employeeId: true })
  .extend({ licenceExpiry: DateSchema.nullable(), status: z.enum(['active', 'inactive']) })
  .partial();
export class UpdateDriverDto extends createZodDto(UpdateDriverSchema) {}

export const SetStopsSchema = z.object({
  stops: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(1).max(80),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        pickupTime: TimeSchema.optional(),
        dropTime: TimeSchema.optional(),
        slabId: IdSchema.optional(),
      }),
    )
    .max(60),
});
export class SetStopsDto extends createZodDto(SetStopsSchema) {}

// ---- Sprint 13: family requests and vehicle logs ----------------------------------------------------
export const UpsertVehicleLogSchema = z
  .object({
    logDate: DateSchema,
    routeId: IdSchema.optional(),
    driverId: IdSchema.optional(),
    odometerStart: z.number().int().min(0).max(10_000_000).optional(),
    odometerEnd: z.number().int().min(0).max(10_000_000).optional(),
    fuelLitres: z.number().min(0).max(10_000).optional(),
    fuelCost: z.number().min(0).max(10_000_000).optional(),
    trips: z.number().int().min(0).max(50).optional(),
    incident: z.string().trim().max(500).optional(),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.odometerStart === undefined ||
      v.odometerEnd === undefined ||
      v.odometerEnd >= v.odometerStart,
    { message: 'odometer end must not be below start', path: ['odometerEnd'] },
  );
export class UpsertVehicleLogDto extends createZodDto(UpsertVehicleLogSchema) {}

export const VehicleLogsQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class VehicleLogsQueryDto extends createZodDto(VehicleLogsQuerySchema) {}
