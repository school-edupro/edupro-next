import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  SetStopsDto,
  UpsertDriverDto,
  UpsertVehicleDto,
  UpdateDriverDto,
  UpdateVehicleDto,
} from './transport.dto';

export interface VehicleRow {
  id: string;
  regNo: string;
  make: string | null;
  capacity: number | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  permitExpiry: string | null;
  gpsDeviceId: string | null;
  status: 'active' | 'inactive';
  routes: string[];
  /** Earliest of the three expiries, for the fleet page. */
  nextExpiry: string | null;
}

export interface DriverRow {
  id: string;
  name: string;
  mobile: string | null;
  licenceNo: string | null;
  licenceExpiry: string | null;
  employeeId: string | null;
  status: 'active' | 'inactive';
  routes: string[];
}

export interface StopRow {
  id: string;
  routeId: string;
  sequence: number;
  name: string;
  lat: string | null;
  lng: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  slabId: string | null;
  slabCode: string | null;
  students: number;
}

const VEHICLE_SELECT = `SELECT v.id::text, v.reg_no AS "regNo", v.make, v.capacity, v.insurance_expiry::text AS "insuranceExpiry", v.fitness_expiry::text AS "fitnessExpiry",
        v.permit_expiry::text AS "permitExpiry", v.gps_device_id AS "gpsDeviceId", v.status::text,
        COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM transport_routes r WHERE r.vehicle_id = v.id AND r.deleted_at IS NULL), '{}') AS routes,
        LEAST(v.insurance_expiry, v.fitness_expiry, v.permit_expiry)::text AS "nextExpiry"
   FROM transport_vehicles v`;
const DRIVER_SELECT = `SELECT d.id::text, d.name, d.mobile, d.licence_no AS "licenceNo", d.licence_expiry::text AS "licenceExpiry", d.employee_id::text AS "employeeId", d.status::text,
        COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM transport_routes r WHERE r.driver_id = d.id AND r.deleted_at IS NULL), '{}') AS routes
   FROM transport_drivers d`;
const STOP_SELECT = `SELECT s.id::text, s.route_id::text AS "routeId", s.sequence, s.name, s.lat::text, s.lng::text, to_char(s.pickup_time, 'HH24:MI') AS "pickupTime",
        to_char(s.drop_time, 'HH24:MI') AS "dropTime", s.slab_id::text AS "slabId", ts.code AS "slabCode",
        (SELECT count(*)::int FROM student_route_assignments a WHERE a.stop_id = s.id AND a.academic_year_id = $1::bigint) AS students
   FROM transport_stops s LEFT JOIN transport_slabs ts ON ts.id = s.slab_id`;

/** Sprint 12: the transport fleet (vehicles, drivers) and route stops with geo and times. */
@Injectable()
export class FleetService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  // ---- vehicles ---------------------------------------------------------------------------------
  async vehicles(ctx: RequestContext): Promise<VehicleRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<VehicleRow>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${VEHICLE_SELECT} WHERE v.deleted_at IS NULL ORDER BY v.reg_no`,
      );
      return r.rows;
    });
  }

  async createVehicle(ctx: RequestContext, dto: UpsertVehicleDto): Promise<VehicleRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO transport_vehicles (school_id, reg_no, make, capacity, insurance_expiry, fitness_expiry, permit_expiry, gps_device_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6::date, $7, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            dto.regNo.toUpperCase().replace(/\s+/g, ''),
            dto.make ?? null,
            dto.capacity ?? null,
            dto.insuranceExpiry ?? null,
            dto.fitnessExpiry ?? null,
            dto.permitExpiry ?? null,
            dto.gpsDeviceId ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Vehicle "${dto.regNo}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'transport.vehicle.create',
        entityType: 'transport_vehicles',
        entityId: id,
        after: dto,
      });
      return this.vehicle(c, id);
    });
  }

  async updateVehicle(ctx: RequestContext, id: string, dto: UpdateVehicleDto): Promise<VehicleRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.vehicle(c, id);
      await c.query(
        `UPDATE transport_vehicles SET make = COALESCE($2, make), capacity = COALESCE($3, capacity),
                insurance_expiry = CASE WHEN $4::boolean THEN $5::date ELSE insurance_expiry END,
                fitness_expiry = CASE WHEN $6::boolean THEN $7::date ELSE fitness_expiry END,
                permit_expiry = CASE WHEN $8::boolean THEN $9::date ELSE permit_expiry END,
                gps_device_id = COALESCE($10, gps_device_id), status = COALESCE($11::row_status, status),
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1 AND deleted_at IS NULL`,
        [
          id,
          dto.make ?? null,
          dto.capacity ?? null,
          dto.insuranceExpiry !== undefined,
          dto.insuranceExpiry ?? null,
          dto.fitnessExpiry !== undefined,
          dto.fitnessExpiry ?? null,
          dto.permitExpiry !== undefined,
          dto.permitExpiry ?? null,
          dto.gpsDeviceId ?? null,
          dto.status ?? null,
        ],
      );
      const after = await this.vehicle(c, id);
      await this.audit.stage(ctx, c, {
        action: 'transport.vehicle.update',
        entityType: 'transport_vehicles',
        entityId: id,
        before: { ...before },
        after: { ...after },
      });
      return after;
    });
  }

  private async vehicle(c: PoolClient, id: string): Promise<VehicleRow> {
    const r = await c.query<VehicleRow>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${VEHICLE_SELECT} WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Vehicle not found', { status: 404 });
    return r.rows[0];
  }

  // ---- drivers ----------------------------------------------------------------------------------
  async drivers(ctx: RequestContext): Promise<DriverRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<DriverRow>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${DRIVER_SELECT} WHERE d.deleted_at IS NULL ORDER BY d.name`,
      );
      return r.rows;
    });
  }

  async createDriver(ctx: RequestContext, dto: UpsertDriverDto): Promise<DriverRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.employeeId) {
        const e = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
          dto.employeeId,
        ]);
        if (e.rowCount === 0) throw new DomainError('not-found', 'Employee not found');
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO transport_drivers (school_id, name, mobile, licence_no, licence_expiry, employee_id, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
        [
          dto.name,
          dto.mobile ?? null,
          dto.licenceNo ?? null,
          dto.licenceExpiry ?? null,
          dto.employeeId ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'transport.driver.create',
        entityType: 'transport_drivers',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return this.driver(c, r.rows[0]!.id);
    });
  }

  async updateDriver(ctx: RequestContext, id: string, dto: UpdateDriverDto): Promise<DriverRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.driver(c, id);
      await c.query(
        `UPDATE transport_drivers SET name = COALESCE($2, name), mobile = COALESCE($3, mobile), licence_no = COALESCE($4, licence_no),
                licence_expiry = CASE WHEN $5::boolean THEN $6::date ELSE licence_expiry END, status = COALESCE($7::row_status, status),
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1 AND deleted_at IS NULL`,
        [
          id,
          dto.name ?? null,
          dto.mobile ?? null,
          dto.licenceNo ?? null,
          dto.licenceExpiry !== undefined,
          dto.licenceExpiry ?? null,
          dto.status ?? null,
        ],
      );
      const after = await this.driver(c, id);
      await this.audit.stage(ctx, c, {
        action: 'transport.driver.update',
        entityType: 'transport_drivers',
        entityId: id,
        before: { ...before },
        after: { ...after },
      });
      return after;
    });
  }

  private async driver(c: PoolClient, id: string): Promise<DriverRow> {
    const r = await c.query<DriverRow>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${DRIVER_SELECT} WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Driver not found', { status: 404 });
    return r.rows[0];
  }

  // ---- stops ------------------------------------------------------------------------------------
  async stops(ctx: RequestContext, routeId: string): Promise<StopRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => this.stopsWith(c, routeId, yearId));
  }

  private async stopsWith(c: PoolClient, routeId: string, yearId: string): Promise<StopRow[]> {
    const r = await c.query<StopRow>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      `${STOP_SELECT} WHERE s.route_id = $2 ORDER BY s.sequence`,
      [yearId, routeId],
    );
    return r.rows;
  }

  /** Replaces the stop list of a route; stops that still exist keep their id (and the students on them). */
  async setStops(ctx: RequestContext, routeId: string, dto: SetStopsDto): Promise<StopRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const route = await c.query(
        `SELECT 1 FROM transport_routes WHERE id = $1 AND deleted_at IS NULL`,
        [routeId],
      );
      if (route.rowCount === 0)
        throw new DomainError('not-found', 'Route not found', { status: 404 });
      const keep: string[] = [];
      for (const [i, s] of dto.stops.entries()) {
        const seq = i + 1;
        if (s.id) {
          const u = await c.query<{ id: string }>(
            `UPDATE transport_stops SET sequence = $3, name = $4, lat = $5, lng = $6, pickup_time = $7::time, drop_time = $8::time, slab_id = $9
              WHERE id = $1 AND route_id = $2 RETURNING id::text`,
            [
              s.id,
              routeId,
              seq + 1000, // offset first: avoids (route_id, sequence) collisions while reordering
              s.name,
              s.lat ?? null,
              s.lng ?? null,
              s.pickupTime ?? null,
              s.dropTime ?? null,
              s.slabId ?? null,
            ],
          );
          if (!u.rows[0]) throw new DomainError('not-found', `Stop ${s.id} is not on this route`);
          keep.push(u.rows[0].id);
        } else {
          const n = await c.query<{ id: string }>(
            `INSERT INTO transport_stops (school_id, route_id, sequence, name, lat, lng, pickup_time, drop_time, slab_id)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::time, $7::time, $8) RETURNING id::text`,
            [
              routeId,
              seq + 1000,
              s.name,
              s.lat ?? null,
              s.lng ?? null,
              s.pickupTime ?? null,
              s.dropTime ?? null,
              s.slabId ?? null,
            ],
          );
          keep.push(n.rows[0]!.id);
        }
      }
      await c.query(
        `UPDATE student_route_assignments SET stop_id = NULL WHERE route_id = $1 AND stop_id IS NOT NULL AND NOT (stop_id = ANY($2::bigint[]))`,
        [routeId, keep],
      );
      await c.query(
        `DELETE FROM transport_stops WHERE route_id = $1 AND NOT (id = ANY($2::bigint[]))`,
        [routeId, keep],
      );
      await c.query(
        `UPDATE transport_stops SET sequence = sequence - 1000 WHERE route_id = $1 AND sequence > 1000`,
        [routeId],
      );
      await this.audit.stage(ctx, c, {
        action: 'transport.route.stops',
        entityType: 'transport_routes',
        entityId: routeId,
        after: { stops: dto.stops.map((s) => s.name) },
      });
      return this.stopsWith(c, routeId, yearId);
    });
  }
}
