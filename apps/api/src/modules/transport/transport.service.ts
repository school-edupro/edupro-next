import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { AssignStudentsDto, CreateRouteDto, UpdateRouteDto } from './transport.dto';

export interface RouteRow {
  id: string;
  code: string;
  name: string;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobile: string | null;
  status: 'active' | 'inactive';
  students: number;
  alertBoarding: boolean;
  alertAlighting: boolean;
  lateAfter: string | null;
  vehicleId: string | null;
  vehicleRegNo: string | null;
  driverId: string | null;
  driverOnRecord: string | null;
  conductorName: string | null;
  conductorMobile: string | null;
  stops: number;
}

const SELECT = `SELECT r.id::text, r.code, r.name, COALESCE(v.reg_no, r.vehicle_no) AS vehicle_no, COALESCE(d.name, r.driver_name) AS driver_name, COALESCE(d.mobile, r.driver_mobile) AS driver_mobile,
        r.status::text, r.alert_boarding, r.alert_alighting, to_char(r.late_after, 'HH24:MI') AS late_after,
        r.vehicle_id::text, v.reg_no AS vehicle_reg_no, r.driver_id::text, d.name AS driver_on_record, r.conductor_name, r.conductor_mobile,
        (SELECT count(*)::int FROM student_route_assignments a WHERE a.route_id = r.id AND a.academic_year_id = $1::bigint) AS students,
        (SELECT count(*)::int FROM transport_stops s WHERE s.route_id = r.id) AS stops
   FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id LEFT JOIN transport_drivers d ON d.id = r.driver_id`;

/** Minimal transport (S10): routes and the students riding them, enough for route audiences and bus readers. */
@Injectable()
export class TransportService {
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

  async list(ctx: RequestContext): Promise<RouteRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the year is a bound parameter
        `${SELECT} WHERE r.deleted_at IS NULL ORDER BY r.code`,
        [yearId],
      );
      return r.rows.map(toRoute);
    });
  }

  async create(ctx: RequestContext, dto: CreateRouteDto): Promise<RouteRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO transport_routes (school_id, code, name, vehicle_no, driver_name, driver_mobile, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            dto.code.toUpperCase(),
            dto.name,
            dto.vehicleNo ?? null,
            dto.driverName ?? null,
            dto.driverMobile ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Route "${dto.code}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'transport.route.create',
        entityType: 'transport_routes',
        entityId: id,
        after: { code: dto.code, name: dto.name },
      });
      return this.find(c, id, this.year(ctx));
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateRouteDto): Promise<RouteRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id, this.year(ctx));
      if (dto.vehicleId) {
        const v = await c.query(
          `SELECT 1 FROM transport_vehicles WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [dto.vehicleId],
        );
        if (v.rowCount === 0) throw new DomainError('not-found', 'Vehicle not found or inactive');
      }
      if (dto.driverId) {
        const d = await c.query(
          `SELECT 1 FROM transport_drivers WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [dto.driverId],
        );
        if (d.rowCount === 0) throw new DomainError('not-found', 'Driver not found or inactive');
      }
      await c.query(
        `UPDATE transport_routes SET name = COALESCE($2, name), vehicle_no = COALESCE($3, vehicle_no), driver_name = COALESCE($4, driver_name), driver_mobile = COALESCE($5, driver_mobile),
                status = COALESCE($6::row_status, status), alert_boarding = COALESCE($7, alert_boarding), alert_alighting = COALESCE($8, alert_alighting),
                late_after = CASE WHEN $9::boolean THEN $10::time ELSE late_after END,
                vehicle_id = CASE WHEN $11::boolean THEN $12::bigint ELSE vehicle_id END,
                driver_id = CASE WHEN $13::boolean THEN $14::bigint ELSE driver_id END,
                conductor_name = CASE WHEN $15::boolean THEN $16 ELSE conductor_name END,
                conductor_mobile = CASE WHEN $17::boolean THEN $18 ELSE conductor_mobile END,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [
          id,
          dto.name ?? null,
          dto.vehicleNo ?? null,
          dto.driverName ?? null,
          dto.driverMobile ?? null,
          dto.status ?? null,
          dto.alertBoarding ?? null,
          dto.alertAlighting ?? null,
          dto.lateAfter !== undefined,
          dto.lateAfter ?? null,
          dto.vehicleId !== undefined,
          dto.vehicleId ?? null,
          dto.driverId !== undefined,
          dto.driverId ?? null,
          dto.conductorName !== undefined,
          dto.conductorName ?? null,
          dto.conductorMobile !== undefined,
          dto.conductorMobile ?? null,
        ],
      );
      const after = await this.find(c, id, this.year(ctx));
      await this.audit.stage(ctx, c, {
        action: 'transport.route.update',
        entityType: 'transport_routes',
        entityId: id,
        before: { ...before },
        after: { ...after },
      });
      return after;
    });
  }

  async students(ctx: RequestContext, routeId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.find(c, routeId, yearId);
      return this.studentsWith(c, routeId, yearId);
    });
  }

  private async studentsWith(c: PoolClient, routeId: string, yearId: string) {
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      section: string | null;
      stop_id: string | null;
      stop_name: string | null;
      pickup_time: string | null;
      drop_time: string | null;
      guardian_mobile: string | null;
    }>(
      `SELECT a.student_id::text, s.display_name AS name, s.admission_no,
              (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS section,
              a.stop_id::text, a.stop_name, a.pickup_time::text, a.drop_time::text,
              (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS guardian_mobile
         FROM student_route_assignments a JOIN students s ON s.id = a.student_id
        WHERE a.route_id = $1 AND a.academic_year_id = $2 ORDER BY a.pickup_time NULLS LAST, s.display_name`,
      [routeId, yearId],
    );
    return r.rows.map((x) => ({
      studentId: x.student_id,
      name: x.name,
      admissionNo: x.admission_no,
      section: x.section,
      stopId: x.stop_id,
      stopName: x.stop_name,
      pickupTime: x.pickup_time ? x.pickup_time.slice(0, 5) : null,
      dropTime: x.drop_time ? x.drop_time.slice(0, 5) : null,
      guardianMobile: x.guardian_mobile,
    }));
  }

  /** Assigns students to the route for the working year (a student rides one route per year). */
  async assign(ctx: RequestContext, routeId: string, dto: AssignStudentsDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.find(c, routeId, yearId);
      for (const a of dto.assignments) {
        let stop: { name: string; pickup: string | null; drop: string | null } | null = null;
        if (a.stopId) {
          const st = await c.query<{ name: string; pickup: string | null; drop: string | null }>(
            `SELECT name, to_char(pickup_time, 'HH24:MI') AS pickup, to_char(drop_time, 'HH24:MI') AS drop FROM transport_stops WHERE id = $1 AND route_id = $2`,
            [a.stopId, routeId],
          );
          if (!st.rows[0]) throw new DomainError('not-found', 'Stop is not on this route');
          stop = st.rows[0];
        }
        await c.query(
          `INSERT INTO student_route_assignments (school_id, student_id, route_id, academic_year_id, stop_id, stop_name, pickup_time, drop_time, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::time, $7::time, app.current_user_id())
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, stop_name = EXCLUDED.stop_name, pickup_time = EXCLUDED.pickup_time, drop_time = EXCLUDED.drop_time`,
          [
            a.studentId,
            routeId,
            yearId,
            a.stopId ?? null,
            a.stopName ?? stop?.name ?? null,
            a.pickupTime ?? stop?.pickup ?? null,
            a.dropTime ?? stop?.drop ?? null,
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'transport.route.assign',
        entityType: 'transport_routes',
        entityId: routeId,
        after: { students: dto.assignments.length },
      });
      return { data: await this.studentsWith(c, routeId, yearId) };
    });
  }

  async unassign(ctx: RequestContext, routeId: string, studentId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `DELETE FROM student_route_assignments WHERE route_id = $1 AND student_id = $2 AND academic_year_id = $3`,
        [routeId, studentId, yearId],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'The student is not on this route', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'transport.route.unassign',
        entityType: 'transport_routes',
        entityId: routeId,
        after: { studentId },
      });
      return { ok: true };
    });
  }

  private async find(c: PoolClient, id: string, yearId: string): Promise<RouteRow> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${SELECT} WHERE r.id = $2 AND r.deleted_at IS NULL`,
      [yearId, id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Route not found', { status: 404 });
    return toRoute(r.rows[0]);
  }
}

const toRoute = (x: Record<string, unknown>): RouteRow => ({
  id: x.id as string,
  code: x.code as string,
  name: x.name as string,
  vehicleNo: (x.vehicle_no as string) ?? null,
  driverName: (x.driver_name as string) ?? null,
  driverMobile: (x.driver_mobile as string) ?? null,
  status: x.status as 'active' | 'inactive',
  students: x.students as number,
  alertBoarding: x.alert_boarding as boolean,
  alertAlighting: x.alert_alighting as boolean,
  lateAfter: (x.late_after as string) ?? null,
  vehicleId: (x.vehicle_id as string) ?? null,
  vehicleRegNo: (x.vehicle_reg_no as string) ?? null,
  driverId: (x.driver_id as string) ?? null,
  driverOnRecord: (x.driver_on_record as string) ?? null,
  conductorName: (x.conductor_name as string) ?? null,
  conductorMobile: (x.conductor_mobile as string) ?? null,
  stops: x.stops as number,
});
