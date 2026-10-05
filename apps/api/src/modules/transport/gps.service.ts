import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';

export interface PositionRow {
  vehicleId: string;
  regNo: string;
  recordedAt: string;
  lat: string;
  lng: string;
  speedKmh: string | null;
  heading: string | null;
  ignition: boolean | null;
  source: string;
  ageSeconds: number;
}

/** One NeverSkip-style fix (the adapter normalises the vendor's field names). */
export interface GpsFix {
  deviceId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  heading?: number | null;
  ignition?: boolean | null;
}

const toRow = (r: Record<string, unknown>): PositionRow => ({
  vehicleId: String(r.vehicle_id),
  regNo: String(r.reg_no),
  recordedAt: new Date(r.recorded_at as string).toISOString(),
  lat: String(r.lat),
  lng: String(r.lng),
  speedKmh: (r.speed_kmh as string | null) ?? null,
  heading: (r.heading as string | null) ?? null,
  ignition: (r.ignition as boolean | null) ?? null,
  source: String(r.source),
  ageSeconds: Number(r.age_seconds),
});

/**
 * Sprint 17: vehicle positions. Fixes arrive from the GPS vendor's push (service key, scope
 * transport.gps) keyed by the device id on the vehicle; the office reads a fleet view, a family
 * reads the last fix of its child's bus.
 */
@Injectable()
export class GpsService {
  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
  ) {}

  /** NeverSkip pushes `{ imei|deviceId, lat, lng, speed, angle|heading, ts|timestamp, acc|ignition }` per point. */
  static normalise(payload: unknown): GpsFix[] {
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : [payload];
    const out: GpsFix[] = [];
    for (const p of list as Array<Record<string, unknown>>) {
      if (!p || typeof p !== 'object') continue;
      const deviceId = String(p.deviceId ?? p.imei ?? p.device_id ?? '').trim();
      const lat = Number(p.lat ?? p.latitude);
      const lng = Number(p.lng ?? p.lon ?? p.longitude);
      const ts = p.recordedAt ?? p.ts ?? p.timestamp ?? p.time;
      const when =
        ts === undefined || ts === null
          ? new Date()
          : typeof ts === 'number'
            ? new Date(ts < 1e12 ? ts * 1000 : ts)
            : new Date(String(ts));
      if (
        !deviceId ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Number.isNaN(when.getTime())
      )
        continue;
      const speed = p.speedKmh ?? p.speed;
      const heading = p.heading ?? p.angle ?? p.course;
      const ign = p.ignition ?? p.acc;
      out.push({
        deviceId,
        recordedAt: when.toISOString(),
        lat,
        lng,
        speedKmh: speed === undefined || speed === null ? null : Number(speed),
        heading: heading === undefined || heading === null ? null : Number(heading),
        ignition:
          ign === undefined || ign === null
            ? null
            : ign === true || ign === 1 || ign === '1' || ign === 'on',
      });
    }
    return out;
  }

  /** Stores fixes for a school (machine context from the service key). Unknown devices are counted, not stored. */
  async ingest(
    ctx: RequestContext,
    fixes: GpsFix[],
  ): Promise<{ accepted: number; unknownDevices: string[] }> {
    if (fixes.length === 0) return { accepted: 0, unknownDevices: [] };
    if (fixes.length > 2000)
      throw new DomainError('validation-failed', 'At most 2,000 points per push', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const devices = await c.query<{ id: string; gps_device_id: string }>(
        `SELECT id::text, gps_device_id FROM transport_vehicles WHERE gps_device_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [[...new Set(fixes.map((f) => f.deviceId))]],
      );
      const byDevice = new Map(devices.rows.map((d) => [d.gps_device_id, d.id]));
      const unknown = new Set<string>();
      let accepted = 0;
      for (const f of fixes) {
        const vehicleId = byDevice.get(f.deviceId);
        if (!vehicleId) {
          unknown.add(f.deviceId);
          continue;
        }
        await c.query(
          `INSERT INTO vehicle_positions (school_id, vehicle_id, recorded_at, lat, lng, speed_kmh, heading, ignition, source)
           VALUES (app.current_school_id(), $1, $2::timestamptz, $3, $4, $5, $6, $7, 'neverskip')`,
          [
            vehicleId,
            f.recordedAt,
            f.lat,
            f.lng,
            f.speedKmh ?? null,
            f.heading ?? null,
            f.ignition ?? null,
          ],
        );
        accepted += 1;
      }
      return { accepted, unknownDevices: [...unknown] };
    });
  }

  /** Last fix per active vehicle. */
  async fleet(ctx: RequestContext): Promise<PositionRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT DISTINCT ON (v.id) v.id::text AS vehicle_id, v.reg_no, p.recorded_at, p.lat::text, p.lng::text, p.speed_kmh::text, p.heading::text, p.ignition, p.source,
                EXTRACT(EPOCH FROM (now() - p.recorded_at))::int AS age_seconds
           FROM transport_vehicles v JOIN vehicle_positions p ON p.vehicle_id = v.id
          WHERE v.deleted_at IS NULL ORDER BY v.id, p.recorded_at DESC`,
      );
      return r.rows.map(toRow);
    });
  }

  async trail(
    ctx: RequestContext,
    vehicleId: string,
    sinceMinutes: number,
  ): Promise<PositionRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT v.id::text AS vehicle_id, v.reg_no, p.recorded_at, p.lat::text, p.lng::text, p.speed_kmh::text, p.heading::text, p.ignition, p.source,
                EXTRACT(EPOCH FROM (now() - p.recorded_at))::int AS age_seconds
           FROM vehicle_positions p JOIN transport_vehicles v ON v.id = p.vehicle_id
          WHERE p.vehicle_id = $1 AND p.recorded_at >= now() - make_interval(mins => $2) ORDER BY p.recorded_at DESC LIMIT 500`,
        [vehicleId, sinceMinutes],
      );
      return r.rows.map(toRow);
    });
  }

  /** A family's view: the bus of each child (by route assignment), its last fix and the child's stop. */
  async mine(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'transport.family.track');
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const r = await c.query<Record<string, unknown>>(
          `SELECT r.code AS route_code, r.name AS route_name, a.stop_name, st.lat::text AS stop_lat, st.lng::text AS stop_lng,
                  to_char(a.pickup_time, 'HH24:MI') AS pickup, v.id::text AS vehicle_id, v.reg_no,
                  reg.reg_no AS regular_reg_no, rep.to_date AS rep_to, rep.reason AS rep_reason, rep.driver AS rep_driver, rep.driver_mobile AS rep_driver_mobile,
                  p.recorded_at, p.lat::text, p.lng::text, p.speed_kmh::text, p.heading::text, p.ignition, p.source,
                  EXTRACT(EPOCH FROM (now() - p.recorded_at))::int AS age_seconds
             FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id
             LEFT JOIN transport_stops st ON st.id = a.stop_id
             -- the vehicle that runs the route today: the replacement while the regular bus is off the road
             LEFT JOIN transport_vehicles v ON v.id = app.transport_vehicle_today(r.vehicle_id) AND v.deleted_at IS NULL
             LEFT JOIN transport_vehicles reg ON reg.id = r.vehicle_id AND reg.id <> v.id
             LEFT JOIN LATERAL (SELECT x.to_date::text, x.reason, d.name AS driver, d.mobile AS driver_mobile FROM transport_replacements x
                                  LEFT JOIN transport_drivers d ON d.id = x.driver_id
                                 WHERE reg.id IS NOT NULL AND x.vehicle_id = reg.id AND x.replacement_vehicle_id = v.id AND x.status = 'active'
                                   AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN x.from_date AND x.to_date ORDER BY x.id DESC LIMIT 1) rep ON true
             LEFT JOIN LATERAL (SELECT * FROM vehicle_positions p WHERE p.vehicle_id = v.id ORDER BY p.recorded_at DESC LIMIT 1) p ON true
            WHERE a.student_id = $1 AND a.academic_year_id = app.current_academic_year_id() LIMIT 1`,
          [s.id],
        );
        const row = r.rows[0];
        children.push({
          student: { id: s.id, name: s.name },
          route: row
            ? {
                code: String(row.route_code),
                name: String(row.route_name),
                stop: (row.stop_name as string | null) ?? null,
                pickup: (row.pickup as string | null) ?? null,
                stopLat: (row.stop_lat as string | null) ?? null,
                stopLng: (row.stop_lng as string | null) ?? null,
              }
            : null,
          vehicle: row?.vehicle_id
            ? { id: String(row.vehicle_id), regNo: String(row.reg_no) }
            : null,
          // set while a replacement bus runs the route in place of the regular one
          replacement: row?.regular_reg_no
            ? {
                regular: String(row.regular_reg_no),
                until: (row.rep_to as string | null) ?? null,
                reason: (row.rep_reason as string | null) ?? null,
                driver: (row.rep_driver as string | null) ?? null,
                driverMobile: (row.rep_driver_mobile as string | null) ?? null,
              }
            : null,
          position: row?.recorded_at ? toRow({ ...row, vehicle_id: row.vehicle_id }) : null,
        });
      }
      return { children };
    });
  }
}
