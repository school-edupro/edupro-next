import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export interface MartStatus {
  mart: string;
  refreshedAt: string | null;
  rows: number | null;
  durationMs: number | null;
  stale: boolean;
}

export interface DashboardAlert {
  severity: 'info' | 'warning' | 'danger';
  code: string;
  message: string;
  href: string | null;
}

export interface PrincipalDashboard {
  date: string;
  year: { id: string; code: string; status: string };
  attendance: {
    strength: number;
    present: number;
    absent: number;
    late: number;
    pct: number | null;
    sections: number;
    markedSections: number;
    unmarked: string[];
    byClass: Array<{
      classId: string;
      classCode: string;
      strength: number;
      present: number;
      absent: number;
      pct: number | null;
    }>;
    trend: Array<{ date: string; pct: number | null; strength: number; present: number }>;
  };
  fees: {
    dueTillDate: string;
    collectedTillDate: string;
    balance: string;
    ageing: Array<{ bucket: string; balance: string; students: number }>;
    collectedToday: string;
    collected7d: string;
    collected30d: string;
    previous7d: string;
    byMode30d: Array<{ mode: string; amount: string; receipts: number }>;
    daily: Array<{ date: string; amount: string }>;
    defaulters: Array<{
      studentId: string;
      name: string;
      admissionNo: string;
      section: string | null;
      balance: string;
      daysOverdue: number;
    }>;
    byClass: Array<{ classCode: string; net: string; paid: string; balance: string }>;
  };
  admissions: Array<{
    cycleId: string;
    code: string;
    status: string;
    total: number;
    byStatus: Array<{ status: string; count: number }>;
  }>;
  comms: {
    last7: Array<{
      channel: string;
      sent: number;
      delivered: number;
      failed: number;
      queued: number;
    }>;
    deliveryRate: number | null;
  };
  approvals: { pending: number; oldestHours: number | null };
  readers: Array<{
    code: string;
    name: string;
    kind: string;
    lastSeenAt: string | null;
    silentHours: number | null;
  }>;
  alerts: DashboardAlert[];
  marts: MartStatus[];
}

const MARTS = [
  'attendance_daily',
  'fee_dues',
  'fee_collection_daily',
  'admissions_funnel',
  'comms_delivery_daily',
] as const;

const pct = (present: number, strength: number): number | null =>
  strength > 0 ? Math.round((present / strength) * 1000) / 10 : null;
const money = (v: string | number | null | undefined) => Number(v ?? 0).toFixed(2);

/**
 * Sprint 12 (AI track): the principal dashboard from the reporting marts plus a few live counts, and the
 * mart refresh status. Numbers are computed in SQL; nothing here is estimated.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async martStatus(ctx: RequestContext): Promise<MartStatus[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.martsWith(c));
  }

  private async martsWith(c: PoolClient): Promise<MartStatus[]> {
    const r = await c.query<{
      mart: string;
      refreshed_at: Date;
      rows: number;
      duration_ms: number;
    }>(
      `SELECT DISTINCT ON (mart) mart, refreshed_at, rows, duration_ms FROM mart.refresh_log ORDER BY mart, refreshed_at DESC`,
    );
    const by = new Map(r.rows.map((x) => [x.mart, x]));
    return MARTS.map((m) => {
      const x = by.get(m);
      return {
        mart: m,
        refreshedAt: x ? x.refreshed_at.toISOString() : null,
        rows: x ? x.rows : null,
        durationMs: x ? x.duration_ms : null,
        stale: !x || Date.now() - x.refreshed_at.getTime() > 45 * 60 * 1000,
      };
    });
  }

  /** Rebuilds the marts of the working school now (the workers do this every 15 minutes). */
  async refresh(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ o_mart: string; o_rows: number; o_ms: number }>(
        `SELECT o_mart, o_rows, o_ms FROM app.refresh_marts()`,
      );
      await this.audit.stage(ctx, c, {
        action: 'insights.mart.refresh',
        entityType: 'mart',
        entityId: tenant.schoolId,
        after: Object.fromEntries(r.rows.map((x) => [x.o_mart, x.o_rows])),
      });
      return { data: r.rows.map((x) => ({ mart: x.o_mart, rows: x.o_rows, durationMs: x.o_ms })) };
    });
  }

  async principal(ctx: RequestContext, date?: string): Promise<PrincipalDashboard> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const y = await c.query<{ id: string; code: string; status: string }>(
        `SELECT id::text, code, status::text FROM academic_years WHERE id = $1`,
        [yearId],
      );
      const d = await c.query<{ day: string; now_ist: string; weekly_off: boolean }>(
        `SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS day, to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS now_ist,
                extract(isodow FROM COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date))::int = ANY (
                  COALESCE((SELECT array_agg(v::int) FROM jsonb_array_elements_text(app.setting('attendance.weekly_off')) v), ARRAY[7])
                ) AS weekly_off`,
        [date ?? null],
      );
      const day = d.rows[0]!.day;
      const nowIst = d.rows[0]!.now_ist;
      const weeklyOff = d.rows[0]!.weekly_off;

      // ---- attendance (mart.attendance_daily) ----
      const att = await c.query<{
        class_id: string;
        class_code: string;
        section: string;
        strength: number;
        present: number;
        absent: number;
        late: number;
        marked: boolean;
      }>(
        `SELECT a.class_id::text, k.code AS class_code, a.section, a.strength, a.present, a.absent, a.late, a.marked
           FROM mart.attendance_daily a JOIN classes k ON k.id = a.class_id
          WHERE a.academic_year_id = $1 AND a.on_date = $2::date ORDER BY k.display_order, a.section`,
        [yearId, day],
      );
      const byClass = new Map<
        string,
        { classId: string; classCode: string; strength: number; present: number; absent: number }
      >();
      let strength = 0;
      let present = 0;
      let absent = 0;
      let late = 0;
      let marked = 0;
      const unmarked: string[] = [];
      for (const r of att.rows) {
        strength += r.strength;
        if (r.marked) {
          marked += 1;
          present += r.present;
          absent += r.absent;
          late += r.late;
        } else unmarked.push(r.section);
        const k = byClass.get(r.class_id) ?? {
          classId: r.class_id,
          classCode: r.class_code,
          strength: 0,
          present: 0,
          absent: 0,
        };
        k.strength += r.strength;
        k.present += r.marked ? r.present : 0;
        k.absent += r.marked ? r.absent : 0;
        byClass.set(r.class_id, k);
      }
      const markedStrength = att.rows.filter((r) => r.marked).reduce((s, r) => s + r.strength, 0);
      const trend = await c.query<{ on_date: string; strength: number; present: number }>(
        `SELECT on_date::text, sum(strength)::int AS strength, sum(present)::int AS present
           FROM mart.attendance_daily WHERE academic_year_id = $1 AND marked AND on_date BETWEEN $2::date - 13 AND $2::date
          GROUP BY on_date ORDER BY on_date`,
        [yearId, day],
      );

      // ---- fees (mart.fee_dues, mart.fee_collection_daily) ----
      const dues = await c.query<{
        due: string;
        collected: string;
        balance: string;
      }>(
        `SELECT COALESCE(sum(net), 0)::text AS due, COALESCE(sum(paid), 0)::text AS collected, COALESCE(sum(balance), 0)::text AS balance
           FROM mart.fee_dues WHERE academic_year_id = $1 AND due_on <= $2::date`,
        [yearId, day],
      );
      const ageing = await c.query<{ bucket: string; balance: string; students: number }>(
        `SELECT bucket, sum(balance)::text AS balance, count(DISTINCT student_id)::int AS students
           FROM mart.fee_dues WHERE academic_year_id = $1 AND balance > 0 GROUP BY bucket`,
        [yearId],
      );
      const order = ['current', '1-30', '31-60', '61-90', '90+'];
      const coll = await c.query<{
        today: string;
        d7: string;
        d30: string;
        p7: string;
      }>(
        `SELECT COALESCE(sum(amount) FILTER (WHERE received_on = $2::date), 0)::text AS today,
                COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 6 AND $2::date), 0)::text AS d7,
                COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 29 AND $2::date), 0)::text AS d30,
                COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 13 AND $2::date - 7), 0)::text AS p7
           FROM mart.fee_collection_daily WHERE academic_year_id = $1`,
        [yearId, day],
      );
      const byMode = await c.query<{ mode: string; amount: string; receipts: number }>(
        `SELECT mode, sum(amount)::text AS amount, sum(receipts)::int AS receipts FROM mart.fee_collection_daily
          WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - 29 AND $2::date GROUP BY mode ORDER BY sum(amount) DESC`,
        [yearId, day],
      );
      const daily = await c.query<{ date: string; amount: string }>(
        `SELECT received_on::text AS date, sum(amount)::text AS amount FROM mart.fee_collection_daily
          WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - 13 AND $2::date GROUP BY received_on ORDER BY received_on`,
        [yearId, day],
      );
      const defaulters = await c.query<{
        student_id: string;
        student_name: string;
        admission_no: string;
        section: string | null;
        balance: string;
        days_overdue: number;
      }>(
        `SELECT student_id::text, student_name, admission_no, section, sum(balance)::text AS balance, max(days_overdue)::int AS days_overdue
           FROM mart.fee_dues WHERE academic_year_id = $1 AND balance > 0 AND due_on < $2::date
          GROUP BY student_id, student_name, admission_no, section ORDER BY sum(balance) DESC LIMIT 10`,
        [yearId, day],
      );
      const feeByClass = await c.query<{
        class_code: string;
        net: string;
        paid: string;
        balance: string;
      }>(
        `SELECT COALESCE(k.code, '—') AS class_code, sum(f.net)::text AS net, sum(f.paid)::text AS paid, sum(f.balance)::text AS balance
           FROM mart.fee_dues f LEFT JOIN classes k ON k.id = f.class_id
          WHERE f.academic_year_id = $1 AND f.due_on <= $2::date GROUP BY k.code, k.display_order ORDER BY k.display_order NULLS LAST`,
        [yearId, day],
      );

      // ---- admissions (mart.admissions_funnel) ----
      const funnel = await c.query<{
        cycle_id: string;
        cycle_code: string;
        cycle_status: string;
        status: string;
        applications: number;
      }>(
        `SELECT cycle_id::text, cycle_code, cycle_status, status, sum(applications)::int AS applications
           FROM mart.admissions_funnel GROUP BY cycle_id, cycle_code, cycle_status, status ORDER BY cycle_code DESC, status`,
      );
      const cycles = new Map<string, PrincipalDashboard['admissions'][number]>();
      for (const f of funnel.rows) {
        const cy = cycles.get(f.cycle_id) ?? {
          cycleId: f.cycle_id,
          code: f.cycle_code,
          status: f.cycle_status,
          total: 0,
          byStatus: [],
        };
        cy.total += f.applications;
        cy.byStatus.push({ status: f.status, count: f.applications });
        cycles.set(f.cycle_id, cy);
      }

      // ---- communication (mart.comms_delivery_daily) ----
      const comms = await c.query<{ channel: string; status: string; messages: number }>(
        `SELECT channel, status, sum(messages)::int AS messages FROM mart.comms_delivery_daily
          WHERE on_date BETWEEN $1::date - 6 AND $1::date GROUP BY channel, status`,
        [day],
      );
      const chan = new Map<string, PrincipalDashboard['comms']['last7'][number]>();
      for (const m of comms.rows) {
        const x = chan.get(m.channel) ?? {
          channel: m.channel,
          sent: 0,
          delivered: 0,
          failed: 0,
          queued: 0,
        };
        if (m.status === 'delivered') x.delivered += m.messages;
        else if (m.status === 'sent') x.sent += m.messages;
        else if (m.status === 'failed') x.failed += m.messages;
        else x.queued += m.messages;
        chan.set(m.channel, x);
      }
      const last7 = [...chan.values()];
      const totalOut = last7.reduce((s, x) => s + x.sent + x.delivered + x.failed, 0);
      const deliveryRate =
        totalOut > 0
          ? Math.round((last7.reduce((s, x) => s + x.sent + x.delivered, 0) / totalOut) * 1000) / 10
          : null;

      // ---- live counts: approvals and readers ----
      const appr = await c.query<{ pending: number; oldest_hours: number | null }>(
        `SELECT count(*)::int AS pending, (extract(epoch FROM now() - min(requested_at)) / 3600)::int AS oldest_hours
           FROM workflow_instances WHERE status = 'pending'`,
      );
      const readers = await c.query<{
        code: string;
        name: string;
        kind: string;
        last_seen_at: Date | null;
        silent_hours: number | null;
      }>(
        `SELECT code, name, kind::text, last_seen_at, (extract(epoch FROM now() - last_seen_at) / 3600)::int AS silent_hours
           FROM rfid_devices WHERE status = 'active' ORDER BY code`,
      );

      const marts = await this.martsWith(c);

      // ---- alerts (rules over the numbers above) ----
      const alerts: DashboardAlert[] = [];
      const overallPct = pct(present, markedStrength);
      const isToday = day === (await today(c));
      // an unmarked section is a problem on a working day only (weekly offs come from the setting)
      if (att.rows.length && unmarked.length && !weeklyOff && (!isToday || nowIst >= '10:00'))
        alerts.push({
          severity: unmarked.length > att.rows.length / 2 ? 'danger' : 'warning',
          code: 'attendance.unmarked',
          message: `${unmarked.length} of ${att.rows.length} sections have no attendance for ${day}`,
          href: '/attendance',
        });
      if (overallPct !== null && overallPct < 85)
        alerts.push({
          severity: overallPct < 75 ? 'danger' : 'warning',
          code: 'attendance.low',
          message: `School attendance is ${overallPct}% today`,
          href: '/attendance',
        });
      for (const k of byClass.values()) {
        const p = pct(k.present, k.present + k.absent);
        if (p !== null && p < 80)
          alerts.push({
            severity: 'warning',
            code: 'attendance.class_low',
            message: `Class ${k.classCode} attendance is ${p}%`,
            href: '/attendance',
          });
      }
      const p7 = Number(coll.rows[0]!.p7);
      const d7 = Number(coll.rows[0]!.d7);
      if (p7 > 0 && d7 < p7 * 0.5)
        alerts.push({
          severity: 'warning',
          code: 'fees.collection_dip',
          message: `Collection this week (₹${d7.toFixed(0)}) is below half of last week (₹${p7.toFixed(0)})`,
          href: '/fees/demands',
        });
      const old = ageing.rows.find((a) => a.bucket === '90+');
      if (old && Number(old.balance) > 0)
        alerts.push({
          severity: 'danger',
          code: 'fees.overdue_90',
          message: `₹${Number(old.balance).toFixed(0)} from ${old.students} students is more than 90 days overdue`,
          href: '/fees/demands',
        });
      for (const r of readers.rows)
        if (r.silent_hours === null || r.silent_hours >= 24)
          alerts.push({
            severity: 'warning',
            code: 'reader.silent',
            message: `Reader ${r.code} (${r.kind}) has not reported for ${r.silent_hours === null ? 'ever' : `${r.silent_hours} h`}`,
            href: '/attendance/rfid',
          });
      const a0 = appr.rows[0]!;
      if (a0.pending > 10 || (a0.oldest_hours ?? 0) > 48)
        alerts.push({
          severity: 'info',
          code: 'approvals.backlog',
          message: `${a0.pending} approvals pending; the oldest waited ${a0.oldest_hours ?? 0} h`,
          href: '/workflow/inbox',
        });
      if (marts.some((m) => m.stale))
        alerts.push({
          severity: 'info',
          code: 'marts.stale',
          message: 'Some numbers are older than 45 minutes; refresh the marts or check the workers',
          href: null,
        });

      return {
        date: day,
        year: y.rows[0]!,
        attendance: {
          strength,
          present,
          absent,
          late,
          pct: overallPct,
          sections: att.rows.length,
          markedSections: marked,
          unmarked,
          byClass: [...byClass.values()].map((k) => ({
            ...k,
            pct: pct(k.present, k.present + k.absent),
          })),
          trend: trend.rows.map((t) => ({
            date: t.on_date,
            strength: t.strength,
            present: t.present,
            pct: pct(t.present, t.strength),
          })),
        },
        fees: {
          dueTillDate: money(dues.rows[0]!.due),
          collectedTillDate: money(dues.rows[0]!.collected),
          balance: money(dues.rows[0]!.balance),
          ageing: order.map((b) => {
            const x = ageing.rows.find((a) => a.bucket === b);
            return { bucket: b, balance: money(x?.balance), students: x?.students ?? 0 };
          }),
          collectedToday: money(coll.rows[0]!.today),
          collected7d: money(d7),
          collected30d: money(coll.rows[0]!.d30),
          previous7d: money(p7),
          byMode30d: byMode.rows.map((m) => ({
            mode: m.mode,
            amount: money(m.amount),
            receipts: m.receipts,
          })),
          daily: daily.rows.map((x) => ({ date: x.date, amount: money(x.amount) })),
          defaulters: defaulters.rows.map((x) => ({
            studentId: x.student_id,
            name: x.student_name,
            admissionNo: x.admission_no,
            section: x.section,
            balance: money(x.balance),
            daysOverdue: x.days_overdue,
          })),
          byClass: feeByClass.rows.map((x) => ({
            classCode: x.class_code,
            net: money(x.net),
            paid: money(x.paid),
            balance: money(x.balance),
          })),
        },
        admissions: [...cycles.values()],
        comms: { last7, deliveryRate },
        approvals: { pending: a0.pending, oldestHours: a0.oldest_hours },
        readers: readers.rows.map((r) => ({
          code: r.code,
          name: r.name,
          kind: r.kind,
          lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
          silentHours: r.silent_hours,
        })),
        alerts,
        marts,
      };
    });
  }
}

async function today(c: PoolClient): Promise<string> {
  const r = await c.query<{ d: string }>(
    `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
  );
  return r.rows[0]!.d;
}
