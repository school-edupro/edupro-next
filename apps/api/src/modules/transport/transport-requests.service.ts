import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type {
  CreateTransportRequestDto,
  DecideTransportRequestDto,
  ListTransportRequestsQueryDto,
  UpsertVehicleLogDto,
  VehicleLogsQueryDto,
} from './transport.dto';

export interface TransportRequestRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  kind: 'join' | 'change' | 'leave';
  routeId: string | null;
  routeCode: string | null;
  routeName: string | null;
  stopId: string | null;
  stopName: string | null;
  effectiveFrom: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The student's current assignment this year, if any. */
  current: { routeCode: string; routeName: string; stopName: string | null } | null;
}

export interface VehicleLogRow {
  id: string;
  vehicleId: string;
  regNo: string;
  routeId: string | null;
  routeCode: string | null;
  driverId: string | null;
  driverName: string | null;
  logDate: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  km: number | null;
  fuelLitres: string | null;
  fuelCost: string | null;
  trips: number | null;
  incident: string | null;
  remarks: string | null;
  createdBy: string | null;
}

const SELECT = `SELECT q.id::text, q.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo",
        (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.student_id = s.id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' LIMIT 1) AS section,
        q.kind::text, q.route_id::text AS "routeId", r.code AS "routeCode", r.name AS "routeName", q.stop_id::text AS "stopId", st.name AS "stopName",
        q.effective_from::text AS "effectiveFrom", q.note, q.status::text, ru.display_name AS "requestedBy", q.requested_at AS "requestedAt",
        q.workflow_instance_id::text AS "workflowInstanceId", du.display_name AS "decidedBy", q.decided_at AS "decidedAt", q.decision_note AS "decisionNote",
        (SELECT jsonb_build_object('routeCode', cr.code, 'routeName', cr.name, 'stopName', a.stop_name)
           FROM student_route_assignments a JOIN transport_routes cr ON cr.id = a.route_id
          WHERE a.student_id = q.student_id AND a.academic_year_id = q.academic_year_id) AS current
   FROM transport_requests q
   JOIN students s ON s.id = q.student_id
   LEFT JOIN transport_routes r ON r.id = q.route_id
   LEFT JOIN transport_stops st ON st.id = q.stop_id
   LEFT JOIN users ru ON ru.id = q.requested_by
   LEFT JOIN users du ON du.id = q.decided_by`;

const toRow = (x: Record<string, unknown>): TransportRequestRow =>
  ({
    ...x,
    requestedAt: (x.requestedAt as Date).toISOString(),
    decidedAt: x.decidedAt ? (x.decidedAt as Date).toISOString() : null,
  }) as TransportRequestRow;

const LOG_SELECT = `SELECT l.id::text, l.vehicle_id::text AS "vehicleId", v.reg_no AS "regNo", l.route_id::text AS "routeId", r.code AS "routeCode",
        l.driver_id::text AS "driverId", d.name AS "driverName", l.log_date::text AS "logDate", l.odometer_start AS "odometerStart", l.odometer_end AS "odometerEnd",
        (l.odometer_end - l.odometer_start) AS km, l.fuel_litres::text AS "fuelLitres", l.fuel_cost::text AS "fuelCost", l.trips, l.incident, l.remarks, u.display_name AS "createdBy"
   FROM transport_vehicle_logs l JOIN transport_vehicles v ON v.id = l.vehicle_id
   LEFT JOIN transport_routes r ON r.id = l.route_id LEFT JOIN transport_drivers d ON d.id = l.driver_id LEFT JOIN users u ON u.id = l.created_by`;

/**
 * Sprint 13: a family asks to join a route, change stop or route, or leave the bus; the office approves
 * through the `transport_request` workflow when one is installed (the completion handler applies the
 * assignment) or decides directly otherwise. Vehicle logs record odometer, fuel, trips and incidents per day.
 */
@Injectable()
export class TransportRequestsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly workflow: WorkflowService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  // ---- family side -------------------------------------------------------------------------------
  async mine(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const v = await this.viewer.resolve(ctx, 'transport.request.view');
    if (v.kind !== 'family') return { children: [], routes: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const current = await c.query<{
          route_code: string;
          route_name: string;
          stop_name: string | null;
          pickup: string | null;
          drop: string | null;
        }>(
          `SELECT r.code AS route_code, r.name AS route_name, a.stop_name, to_char(a.pickup_time, 'HH24:MI') AS pickup, to_char(a.drop_time, 'HH24:MI') AS drop
             FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id WHERE a.student_id = $1 AND a.academic_year_id = $2`,
          [s.id, yearId],
        );
        const reqs = await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
          `${SELECT} WHERE q.student_id = $1 AND q.academic_year_id = $2 ORDER BY q.requested_at DESC LIMIT 10`,
          [s.id, yearId],
        );
        const cur = current.rows[0];
        children.push({
          id: s.id,
          name: s.name,
          section: s.section,
          assignment: cur
            ? {
                routeCode: cur.route_code,
                routeName: cur.route_name,
                stopName: cur.stop_name,
                pickupTime: cur.pickup,
                dropTime: cur.drop,
              }
            : null,
          requests: reqs.rows.map(toRow),
        });
      }
      const routes = await c.query<{
        id: string;
        code: string;
        name: string;
        stops: Array<{ id: string; name: string; pickupTime: string | null }>;
      }>(
        `SELECT r.id::text, r.code, r.name,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'pickupTime', to_char(s.pickup_time, 'HH24:MI')) ORDER BY s.sequence)
                            FROM transport_stops s WHERE s.route_id = r.id), '[]'::jsonb) AS stops
           FROM transport_routes r WHERE r.deleted_at IS NULL AND r.status = 'active' ORDER BY r.code`,
      );
      return { children, routes: routes.rows };
    });
  }

  async create(ctx: RequestContext, dto: CreateTransportRequestDto): Promise<TransportRequestRow> {
    const yearId = this.year(ctx);
    const v = await this.viewer.resolve(ctx, 'transport.request.view');
    if (v.kind !== 'family' || !v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('permission-denied', 'Not one of your children', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.kind !== 'leave') {
        const r = await c.query(
          `SELECT 1 FROM transport_routes WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [dto.routeId],
        );
        if (r.rowCount === 0)
          throw new DomainError('not-found', 'Route not found', { status: 404 });
        if (dto.stopId) {
          const st = await c.query(
            `SELECT 1 FROM transport_stops WHERE id = $1 AND route_id = $2`,
            [dto.stopId, dto.routeId],
          );
          if (st.rowCount === 0) throw new DomainError('not-found', 'Stop is not on this route');
        }
      } else {
        const a = await c.query(
          `SELECT 1 FROM student_route_assignments WHERE student_id = $1 AND academic_year_id = $2`,
          [dto.studentId, yearId],
        );
        if (a.rowCount === 0)
          throw new DomainError('transport.not_riding', 'The student is not on a bus this year', {
            status: 409,
          });
      }
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO transport_requests (school_id, student_id, academic_year_id, kind, route_id, stop_id, effective_from, note, requested_by, request_id)
           VALUES (app.current_school_id(), $1, $2, $3::transport_request_kind, $4, $5, $6::date, $7, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
          [
            dto.studentId,
            yearId,
            dto.kind,
            dto.kind === 'leave' ? null : dto.routeId,
            dto.kind === 'leave' ? null : (dto.stopId ?? null),
            dto.effectiveFrom ?? null,
            dto.note ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'transport.request_open',
            'A request for this student is already waiting for a decision',
            { status: 409 },
          );
        throw error;
      }
      // the office's workflow, when installed; otherwise the request waits for a direct decision
      const def = await c.query<{ code: string }>(
        `SELECT code FROM workflow_definitions WHERE entity_type = 'transport_request' AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      );
      if (def.rows[0]) {
        const student = v.students.find((s) => s.id === dto.studentId)!;
        const instance = await this.workflow.start(c, ctx, {
          definitionCode: def.rows[0].code,
          entityType: 'transport_request',
          entityId: id,
          subject: `Bus ${dto.kind}: ${student.name}${student.section ? ` (${student.section})` : ''}`,
          payload: { kind: dto.kind, routeId: dto.routeId ?? null, stopId: dto.stopId ?? null },
        });
        await c.query(`UPDATE transport_requests SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instance.id,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'transport.request.create',
        entityType: 'transport_requests',
        entityId: id,
        after: { ...dto },
      });
      return this.find(c, id);
    });
  }

  // ---- office side -------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: ListTransportRequestsQueryDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE q.academic_year_id = $1 AND ($2::workflow_status IS NULL OR q.status = $2::workflow_status)
          ORDER BY (q.status = 'pending') DESC, q.requested_at DESC LIMIT 300`,
        [yearId, q.status ?? null],
      );
      return r.rows.map(toRow);
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideTransportRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (before.status !== 'pending')
        throw new DomainError('transport.request_decided', 'This request has been decided', {
          status: 409,
        });
      if (before.workflowInstanceId) {
        const open = await c.query(
          `SELECT 1 FROM workflow_instances WHERE id = $1 AND status = 'pending'`,
          [before.workflowInstanceId],
        );
        if (open.rowCount)
          throw new DomainError(
            'transport.request_in_workflow',
            'This request is in the approval inbox; decide it there',
            { status: 409 },
          );
      }
      await this.apply(c, id, dto.outcome, dto.note ?? null);
      const after = await this.find(c, id);
      await this.audit.stage(ctx, c, {
        action: `transport.request.${dto.outcome}`,
        entityType: 'transport_requests',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status, note: dto.note },
      });
      return after;
    });
  }

  /** Workflow completion (inside the final step's transaction). */
  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((s) => s.status === outcome)?.note ?? null;
    await this.apply(c, instance.entityId, outcome, note);
    await this.audit.stage(ctx, c, {
      action: `transport.request.${outcome}`,
      entityType: 'transport_requests',
      entityId: instance.entityId,
      after: { workflowInstanceId: instance.id },
    });
  }

  private async apply(
    c: PoolClient,
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ): Promise<void> {
    const q = await c.query<{
      student_id: string;
      academic_year_id: string;
      kind: string;
      route_id: string | null;
      stop_id: string | null;
      status: string;
    }>(
      `SELECT student_id::text, academic_year_id::text, kind::text, route_id::text, stop_id::text, status::text FROM transport_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = q.rows[0];
    if (!r) throw new DomainError('not-found', 'Transport request not found', { status: 404 });
    if (r.status !== 'pending') return;
    if (outcome === 'approved') {
      if (r.kind === 'leave') {
        await c.query(
          `DELETE FROM student_route_assignments WHERE student_id = $1 AND academic_year_id = $2`,
          [r.student_id, r.academic_year_id],
        );
      } else {
        const stop = r.stop_id
          ? (
              await c.query<{ name: string; pickup: string | null; drop: string | null }>(
                `SELECT name, to_char(pickup_time, 'HH24:MI') AS pickup, to_char(drop_time, 'HH24:MI') AS drop FROM transport_stops WHERE id = $1`,
                [r.stop_id],
              )
            ).rows[0]
          : null;
        await c.query(
          `INSERT INTO student_route_assignments (school_id, student_id, route_id, academic_year_id, stop_id, stop_name, pickup_time, drop_time, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::time, $7::time, app.current_user_id())
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, stop_name = EXCLUDED.stop_name, pickup_time = EXCLUDED.pickup_time, drop_time = EXCLUDED.drop_time`,
          [
            r.student_id,
            r.route_id,
            r.academic_year_id,
            r.stop_id,
            stop?.name ?? null,
            stop?.pickup ?? null,
            stop?.drop ?? null,
          ],
        );
      }
    }
    await c.query(
      `UPDATE transport_requests SET status = $2::workflow_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3 WHERE id = $1`,
      [id, outcome, note],
    );
  }

  private async find(c: PoolClient, id: string): Promise<TransportRequestRow> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${SELECT} WHERE q.id = $1`,
      [id],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Transport request not found', { status: 404 });
    return toRow(r.rows[0]);
  }

  // ---- vehicle logs ------------------------------------------------------------------------------
  async logs(
    ctx: RequestContext,
    vehicleId: string,
    q: VehicleLogsQueryDto,
  ): Promise<VehicleLogRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<VehicleLogRow>(
        // eslint-disable-next-line no-restricted-syntax -- LOG_SELECT is a constant; values are bound parameters
        `${LOG_SELECT} WHERE l.vehicle_id = $1 AND ($2::date IS NULL OR l.log_date >= $2::date) AND ($3::date IS NULL OR l.log_date <= $3::date)
          ORDER BY l.log_date DESC LIMIT 200`,
        [vehicleId, q.from ?? null, q.to ?? null],
      );
      return r.rows;
    });
  }

  async addLog(
    ctx: RequestContext,
    vehicleId: string,
    dto: UpsertVehicleLogDto,
  ): Promise<VehicleLogRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query(
        `SELECT 1 FROM transport_vehicles WHERE id = $1 AND deleted_at IS NULL`,
        [vehicleId],
      );
      if (v.rowCount === 0)
        throw new DomainError('not-found', 'Vehicle not found', { status: 404 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO transport_vehicle_logs (school_id, vehicle_id, route_id, driver_id, log_date, odometer_start, odometer_end, fuel_litres, fuel_cost, trips, incident, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, app.current_user_id())
         ON CONFLICT (vehicle_id, log_date) DO UPDATE SET route_id = EXCLUDED.route_id, driver_id = EXCLUDED.driver_id, odometer_start = EXCLUDED.odometer_start,
           odometer_end = EXCLUDED.odometer_end, fuel_litres = EXCLUDED.fuel_litres, fuel_cost = EXCLUDED.fuel_cost, trips = EXCLUDED.trips, incident = EXCLUDED.incident, remarks = EXCLUDED.remarks
         RETURNING id::text`,
        [
          vehicleId,
          dto.routeId ?? null,
          dto.driverId ?? null,
          dto.logDate,
          dto.odometerStart ?? null,
          dto.odometerEnd ?? null,
          dto.fuelLitres ?? null,
          dto.fuelCost ?? null,
          dto.trips ?? null,
          dto.incident ?? null,
          dto.remarks ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'transport.log.record',
        entityType: 'transport_vehicle_logs',
        entityId: r.rows[0]!.id,
        after: { vehicleId, ...dto },
      });
      const row = await c.query<VehicleLogRow>(
        // eslint-disable-next-line no-restricted-syntax -- LOG_SELECT is a constant; the id is a bound parameter
        `${LOG_SELECT} WHERE l.id = $1`,
        [r.rows[0]!.id],
      );
      return row.rows[0]!;
    });
  }
}
