import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { UpsertVehicleLogDto, VehicleLogsQueryDto } from './transport.dto';

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

const LOG_SELECT = `SELECT l.id::text, l.vehicle_id::text AS "vehicleId", v.reg_no AS "regNo", l.route_id::text AS "routeId", r.code AS "routeCode",
        l.driver_id::text AS "driverId", d.name AS "driverName", l.log_date::text AS "logDate", l.odometer_start AS "odometerStart", l.odometer_end AS "odometerEnd",
        (l.odometer_end - l.odometer_start) AS km, l.fuel_litres::text AS "fuelLitres", l.fuel_cost::text AS "fuelCost", l.trips, l.incident, l.remarks, u.display_name AS "createdBy"
   FROM transport_vehicle_logs l JOIN transport_vehicles v ON v.id = l.vehicle_id
   LEFT JOIN transport_routes r ON r.id = l.route_id LEFT JOIN transport_drivers d ON d.id = l.driver_id LEFT JOIN users u ON u.id = l.created_by`;

/** Sprint 13: the daily log of a vehicle. (Requests moved to TransportDeskService with transport v2.) */
@Injectable()
export class TransportRequestsService {
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
