import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { DayQueryDto, PunchIngestDto } from './attendance.dto';
import { RfidService } from './rfid.service';

/**
 * Employee punch ingestion (S10, legacy Employee_Punching_Detail / al_punch_log): biometric devices post
 * (biometric id, time, direction?) with their device key; the day summary derives first in and last out.
 */
@Injectable()
export class PunchService {
  constructor(
    private readonly db: DbService,
    private readonly rfid: RfidService,
  ) {}

  async ingest(dto: PunchIngestDto, apiKey: string | undefined) {
    const lookup = await this.rfid.authenticateDevice(dto.school, dto.device, apiKey);
    if (lookup.kind !== 'biometric')
      throw new DomainError('device-kind', 'This device is not a biometric punch device', {
        status: 409,
      });
    return this.db.tenant(this.rfid.tenantFor(lookup.school_id), async (c) => {
      const outcomes: Record<string, number> = {};
      for (const ev of dto.events) {
        const emp = await c.query<{ id: string }>(
          `SELECT id::text FROM employees WHERE biometric_id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [ev.id],
        );
        const employeeId = emp.rows[0]?.id ?? null;
        let outcome = employeeId ? 'recorded' : 'unknown_id';
        if (employeeId) {
          const dup = await c.query(
            `SELECT 1 FROM punch_logs WHERE employee_id = $1 AND punched_at BETWEEN $2::timestamptz - interval '60 seconds' AND $2::timestamptz + interval '60 seconds' AND outcome = 'recorded'`,
            [employeeId, ev.at],
          );
          if (dup.rowCount) outcome = 'duplicate';
        }
        const ins = await c.query(
          `INSERT INTO punch_logs (school_id, device_id, employee_id, biometric_id, punched_at, direction, outcome, raw)
           VALUES (app.current_school_id(), $1, $2, $3, $4::timestamptz, $5::rfid_direction, $6, $7::jsonb) ON CONFLICT (device_id, biometric_id, punched_at) DO NOTHING`,
          [
            lookup.device_id,
            employeeId,
            ev.id,
            ev.at,
            ev.direction ?? null,
            outcome,
            JSON.stringify(ev),
          ],
        );
        if (!ins.rowCount) outcome = 'duplicate';
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      await c.query(`UPDATE rfid_devices SET last_seen_at = now() WHERE id = $1`, [
        lookup.device_id,
      ]);
      return { received: dto.events.length, outcomes };
    });
  }

  /** First in, last out and hours per employee for a date (IST), plus who has not punched. */
  async summary(ctx: RequestContext, q: DayQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const date =
        q.date ??
        (
          await c.query<{ d: string }>(
            `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
          )
        ).rows[0]!.d;
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        designation: string | null;
        department: string | null;
        first_in: Date | null;
        last_out: Date | null;
        punches: number;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department,
                min(p.punched_at) AS first_in, CASE WHEN count(p.id) > 1 THEN max(p.punched_at) END AS last_out, count(p.id)::int AS punches
           FROM employees e LEFT JOIN punch_logs p ON p.employee_id = e.id AND p.outcome = 'recorded' AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
          WHERE e.deleted_at IS NULL AND e.status = 'active' GROUP BY e.id ORDER BY e.display_name`,
        [date],
      );
      const rows = r.rows.map((x) => ({
        employeeId: x.id,
        code: x.code,
        name: x.name,
        designation: x.designation,
        department: x.department,
        firstIn: x.first_in ? x.first_in.toISOString() : null,
        lastOut: x.last_out ? x.last_out.toISOString() : null,
        punches: x.punches,
        hours:
          x.first_in && x.last_out
            ? Math.round(((x.last_out.getTime() - x.first_in.getTime()) / 36e5) * 100) / 100
            : null,
      }));
      return {
        date,
        present: rows.filter((x) => x.firstIn).length,
        absent: rows.filter((x) => !x.firstIn).length,
        rows,
      };
    });
  }

  async log(ctx: RequestContext, q: DayQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const date =
        q.date ??
        (
          await c.query<{ d: string }>(
            `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
          )
        ).rows[0]!.d;
      const r = await c.query<{
        id: string;
        device: string;
        biometric_id: string;
        employee: string | null;
        punched_at: Date;
        direction: string | null;
        outcome: string;
      }>(
        `SELECT p.id::text, d.code AS device, p.biometric_id, e.display_name AS employee, p.punched_at, p.direction::text, p.outcome
           FROM punch_logs p JOIN rfid_devices d ON d.id = p.device_id LEFT JOIN employees e ON e.id = p.employee_id
          WHERE (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date ORDER BY p.punched_at DESC LIMIT 500`,
        [date],
      );
      return {
        date,
        data: r.rows.map((x) => ({
          id: x.id,
          device: x.device,
          biometricId: x.biometric_id,
          employee: x.employee,
          punchedAt: x.punched_at.toISOString(),
          direction: x.direction,
          outcome: x.outcome,
        })),
      };
    });
  }
}
