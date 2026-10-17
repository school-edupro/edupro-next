import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { generatedOn, monthName, registerFile, schoolHead } from '../attendance/register-file';
import { HOSTEL_H3 } from './hostel.dto';
import { RECORD_ALLERGY, dietLists } from './hostel-diets.service';
import { shortNames } from './hostel-life.service';
import type {
  FeedbackDto,
  FeedbackQueryDto,
  HeadcountDto,
  MealRegisterDto,
} from './hostel-mess.dto';
import { HostelService } from './hostel.service';

type Row = Record<string, unknown>;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A meal's time on a day as an instant (IST). */
const slotOf = (day: string, at: string) => Date.parse(`${day}T${at}:00+05:30`);
/** The register's mark: P had the meal, X skipped, LV away on hostel leave, - not marked. */
export const MEAL_CODE = { had: 'P', skipped: 'X', away: 'LV', unmarked: '-' } as const;

/**
 * The mess in numbers (0161): the month's meal register of a hostel (who had, skipped or was away for
 * each meal), the kitchen head count of a day (to cook per meal, split by diet, with the allergies), and
 * the families' feedback on the meals.
 */
@Injectable()
export class HostelMealReportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly hostel: HostelService,
  ) {}

  /** The hostels the person sees, and the one asked for (the first when none). */
  private async pick(ctx: RequestContext, c: PoolClient, hostelId?: string) {
    const only = await this.hostel.scope(ctx, c);
    const hostels = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM hostels WHERE ($1::bigint[] IS NULL OR id = ANY ($1::bigint[])) ORDER BY name`,
      [only],
    );
    const hostel = hostelId ? hostels.rows.find((h) => h.id === hostelId) : hostels.rows[0];
    if (!hostel)
      throw new DomainError(
        hostelId ? 'permission-denied' : 'not-found',
        hostelId ? 'You see your own hostel only' : 'No hostel is set up',
        { status: hostelId ? 403 : 404 },
      );
    return { hostel, hostels: hostels.rows, only };
  }

  /** Hostel leave of these pupils that overlaps a period: out and back, as instants. */
  private async awayTimes(c: PoolClient, ids: string[], from: string, to: string) {
    const r = await c.query<{ sid: string; out: number; back: number | null }>(
      `SELECT student_id::text AS sid, extract(epoch FROM out_at) * 1000 AS out, extract(epoch FROM in_at) * 1000 AS back
         FROM gate_passes WHERE student_id = ANY ($1::bigint[]) AND kind IN ('hostel_home', 'hostel_outing') AND out_at IS NOT NULL
          AND out_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
          AND (in_at IS NULL OR in_at >= $2::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [ids, from, to],
    );
    const by = new Map<string, Array<{ out: number; back: number | null }>>();
    for (const x of r.rows)
      by.set(x.sid, [
        ...(by.get(x.sid) ?? []),
        { out: Number(x.out), back: x.back === null ? null : Number(x.back) },
      ]);
    return (sid: string, at: number) =>
      (by.get(sid) ?? []).some((p) => p.out <= at && (p.back === null || p.back > at));
  }

  // ---- the meal register ----------------------------------------------------------------------------------
  async register(ctx: RequestContext, q: MealRegisterDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { hostel, hostels } = await this.pick(ctx, c, q.hostelId);
      const today = istToday();
      const first = `${q.month}-01`;
      const end = new Date(Date.UTC(Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);
      const last = end < today ? end : today;
      const days: string[] = [];
      for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
      const meals = await c.query<{ id: string; name: string; at: string }>(
        `SELECT m.id::text, m.name, to_char(m.at_time, 'HH24:MI') AS at FROM hostel_meals m
          WHERE m.hostel_id = $1 AND (m.active OR EXISTS (
                SELECT 1 FROM hostel_meal_marks k WHERE k.meal_id = m.id AND k.on_date BETWEEN $2::date AND $3::date))
          ORDER BY m.at_time, m.id`,
        [hostel.id, first, end],
      );
      const short = shortNames(meals.rows.map((m) => m.name));
      const pupils = days.length
        ? await c.query<Row>(
            `WITH pupils AS (
               SELECT DISTINCT a.student_id FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
                WHERE r.hostel_id = $1 AND a.from_date <= $3::date AND (a.to_date IS NULL OR a.to_date >= $2::date))
             SELECT s.id::text, s.display_name AS name, s.admission_no AS "admissionNo",
                    ARRAY(SELECT d::date::text FROM generate_series($2::date, $3::date, '1 day') d
                           WHERE app.hostel_of(s.id, d::date) = $1) AS stay
               FROM pupils p JOIN students s ON s.id = p.student_id ORDER BY s.display_name, s.id`,
            [hostel.id, first, last],
          )
        : { rows: [] as Row[] };
      const marks = await c.query<{ id: string; meal: string; on: string; served: number }>(
        `SELECT id::text, meal_id::text AS meal, on_date::text AS "on", served FROM hostel_meal_marks
          WHERE meal_id = ANY ($1::bigint[]) AND on_date BETWEEN $2::date AND $3::date`,
        [meals.rows.map((m) => m.id), first, last],
      );
      const skips = await c.query<{ mark: string; sid: string }>(
        `SELECT mark_id::text AS mark, student_id::text AS sid FROM hostel_meal_skips WHERE mark_id = ANY ($1::bigint[])`,
        [marks.rows.map((m) => m.id)],
      );
      const skipped = new Set(skips.rows.map((x) => `${x.mark}|${x.sid}`));
      const markOf = new Map(marks.rows.map((m) => [`${m.meal}|${m.on}`, m.id]));
      const away = await this.awayTimes(
        c,
        pupils.rows.map((p) => String(p.id)),
        first,
        last,
      );
      const keys = days.flatMap((d) => meals.rows.map((m) => ({ day: d, meal: m.id, at: m.at })));
      const rows = pupils.rows.map((p) => {
        const stay = new Set(p.stay as string[]);
        const n = { had: 0, skipped: 0, away: 0 };
        const cells = keys.map((k) => {
          if (!stay.has(k.day)) return '';
          const mk = markOf.get(`${k.meal}|${k.day}`);
          if (away(String(p.id), slotOf(k.day, k.at))) {
            n.away += 1;
            return MEAL_CODE.away;
          }
          if (!mk) return MEAL_CODE.unmarked;
          if (skipped.has(`${mk}|${String(p.id)}`)) {
            n.skipped += 1;
            return MEAL_CODE.skipped;
          }
          n.had += 1;
          return MEAL_CODE.had;
        });
        return {
          studentId: String(p.id),
          name: String(p.name),
          admissionNo: (p.admissionNo as string | null) ?? '',
          cells,
          ...n,
        };
      });
      const head = await schoolHead(c);
      return {
        school: head.name,
        address: head.address,
        hostel,
        hostels,
        month: q.month,
        days,
        meals: meals.rows.map((m, i) => ({ id: m.id, name: m.name, at: m.at, short: short[i]! })),
        columns: keys.map((k, i) => ({
          day: k.day,
          meal: k.meal,
          marked: markOf.has(`${k.meal}|${k.day}`),
          had: rows.filter((r) => r.cells[i] === MEAL_CODE.had).length,
        })),
        rows,
      };
    });
  }

  async registerFile(ctx: RequestContext, q: MealRegisterDto, format: 'xlsx' | 'pdf') {
    const reg = await this.register(ctx, q);
    const many = reg.meals.length > 1;
    return registerFile(
      {
        school: reg.school,
        address: reg.address,
        report: 'Hostel meal register',
        details: [reg.hostel.name, monthName(reg.month), generatedOn()],
        legend: `${many ? `${reg.meals.map((m) => `${m.short} ${m.name} (${m.at})`).join(' · ')} · ` : ''}P had the meal · X skipped · LV away on hostel leave · - not marked · blank: no bed in the hostel that day`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Pupil', width: 16 },
          { label: 'Adm. no.', width: 7 },
          ...reg.columns.map((col, i) => ({
            label: many ? reg.meals[i % reg.meals.length]!.short : col.day.slice(8),
            width: 2.4,
            center: true,
            group: many ? col.day.slice(8) : undefined,
          })),
          { label: 'Had', width: 4, right: true },
          { label: 'Skipped', width: 5, right: true },
          { label: 'Away', width: 4, right: true },
        ],
        rows: [
          ...reg.rows.map((r, i) => [
            i + 1,
            r.name,
            r.admissionNo,
            ...r.cells,
            r.had,
            r.skipped,
            r.away,
          ]),
          [
            '',
            'Had the meal',
            '',
            ...reg.columns.map((col) => (col.marked ? col.had : '-')),
            reg.rows.reduce((n, r) => n + r.had, 0),
            reg.rows.reduce((n, r) => n + r.skipped, 0),
            reg.rows.reduce((n, r) => n + r.away, 0),
          ],
        ],
        strong: [reg.rows.length],
        filename: `hostel-meal-register-${reg.month}`,
      },
      format,
    );
  }

  // ---- the kitchen head count -------------------------------------------------------------------------------
  /**
   * For each meal of a day: the boarders, those away on hostel leave at the meal's time (out at the gate,
   * or an approved home leave due to go), how many to cook, split by diet, no onion-garlic and allergies;
   * and once the meal is marked, how many had it.
   */
  async headcount(ctx: RequestContext, q: HeadcountDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const on = q.on ?? istToday();
      const { hostels: all } = await this.pick(ctx, c, q.hostelId);
      const hostels = q.hostelId ? all.filter((h) => h.id === q.hostelId) : all;
      const lists = await dietLists(c);
      const def = lists.types.find((t) => t.isDefault)?.code ?? 'veg';
      const types = lists.types.filter((t) => t.active || t.used);
      const out: Array<Row> = [];
      for (const h of hostels) {
        const meals = await c.query<{ id: string; name: string; at: string }>(
          `SELECT id::text, name, to_char(at_time, 'HH24:MI') AS at FROM hostel_meals WHERE hostel_id = $1 AND active ORDER BY at_time`,
          [h.id],
        );
        const boarders = await c.query<{
          id: string;
          diet: string;
          nog: boolean;
          allergies: string[];
          record: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- RECORD_ALLERGY is a fixed SQL fragment; values are bound
          `SELECT st.id::text, COALESCE(d.diet, $2) AS diet, COALESCE(d.no_onion_garlic, false) AS nog,
                  COALESCE(d.allergies, '{}') AS allergies, ${RECORD_ALLERGY} AS record
             FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
             JOIN students st ON st.id = a.student_id LEFT JOIN hostel_diets d ON d.student_id = st.id
            WHERE r.hostel_id = $1 AND a.from_date <= $3::date AND (a.to_date IS NULL OR a.to_date >= $3::date)`,
          [h.id, def, on],
        );
        const ids = boarders.rows.map((b) => b.id);
        const gone = await this.awayTimes(c, ids, on, on);
        // approved home leave not yet out at the gate, due to go before the meal
        const planned = await c.query<{ sid: string; from: number; back: number | null }>(
          `SELECT student_id::text AS sid,
                  extract(epoch FROM (on_date + COALESCE(at_time, '00:00'::time))::timestamp AT TIME ZONE 'Asia/Kolkata') * 1000 AS from,
                  extract(epoch FROM return_by) * 1000 AS back
             FROM gate_passes WHERE student_id = ANY ($1::bigint[]) AND kind = 'hostel_home' AND out_at IS NULL
              AND state IN ('approved', 'handed_over') AND on_date <= $2::date`,
          [ids, on],
        );
        for (const m of meals.rows) {
          const at = slotOf(on, m.at);
          const away = new Set(
            ids.filter(
              (id) =>
                gone(id, at) ||
                planned.rows.some(
                  (p) =>
                    p.sid === id &&
                    Number(p.from) <= at &&
                    (p.back === null || Number(p.back) > at),
                ),
            ),
          );
          const here = boarders.rows.filter((b) => !away.has(b.id));
          const allergies = new Map<string, number>();
          for (const b of here)
            for (const a of b.allergies) allergies.set(a, (allergies.get(a) ?? 0) + 1);
          const mark = (
            await c.query<{ served: number; skipped: number }>(
              `SELECT k.served, (SELECT count(*) FROM hostel_meal_skips s WHERE s.mark_id = k.id)::int AS skipped
                 FROM hostel_meal_marks k WHERE k.meal_id = $1 AND k.on_date = $2`,
              [m.id, on],
            )
          ).rows[0];
          out.push({
            hostelId: h.id,
            hostel: h.name,
            mealId: m.id,
            meal: m.name,
            atTime: m.at,
            boarders: boarders.rows.length,
            away: away.size,
            toCook: here.length,
            byDiet: types.map((t) => ({
              diet: t.code,
              name: t.name,
              n: here.filter((b) => b.diet === t.code).length,
            })),
            noOnionGarlic: here.filter((b) => b.nog).length,
            allergies: [...allergies.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => ({ name, n })),
            onRecord: here.filter((b) => b.record).length,
            marked: mark ? { had: Number(mark.served), skipped: Number(mark.skipped) } : null,
          });
        }
      }
      return {
        on,
        diets: types.map((t) => ({ code: t.code, name: t.name })),
        hostels: all,
        rows: out,
      };
    });
  }

  async headcountFile(ctx: RequestContext, q: HeadcountDto, format: 'xlsx' | 'pdf') {
    const hc = await this.headcount(ctx, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const day = new Date(`${hc.on}T00:00:00Z`).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Kitchen head count',
        details: [day, generatedOn()],
        legend:
          "Away: on hostel leave at the meal's time (out at the gate, or an approved home leave due to go). On record: pupils with an allergy written on their record.",
        columns: [
          { label: 'Hostel', width: 12 },
          { label: 'Meal', width: 12 },
          { label: 'Boarders', width: 6, right: true },
          { label: 'Away', width: 5, right: true },
          { label: 'To cook', width: 6, right: true },
          ...hc.diets.map((d) => ({ label: d.name, width: 7, right: true })),
          { label: 'No onion-garlic', width: 6, right: true },
          { label: 'Allergies', width: 18 },
          { label: 'On record', width: 5, right: true },
          { label: 'Had (marked)', width: 6, right: true },
        ],
        rows: hc.rows.map((r) => [
          String(r.hostel),
          `${String(r.meal)} (${String(r.atTime)})`,
          Number(r.boarders),
          Number(r.away),
          Number(r.toCook),
          ...(r.byDiet as Array<{ n: number }>).map((d) => d.n),
          Number(r.noOnionGarlic),
          (r.allergies as Array<{ name: string; n: number }>)
            .map((a) => `${a.name} ${String(a.n)}`)
            .join(', '),
          Number(r.onRecord),
          r.marked ? (r.marked as { had: number }).had : '',
        ]),
        filename: `kitchen-head-count-${hc.on}`,
      },
      format,
    );
  }

  // ---- feedback ------------------------------------------------------------------------------------------------
  private async family(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
  }

  /** The meals of the last three days a child had (or could have had), with the family's rating. */
  async familyFeedback(ctx: RequestContext, studentId: string) {
    await this.family(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = istToday();
      const days = [today, addDays(today, -1), addDays(today, -2)];
      const out: Row[] = [];
      for (const d of days) {
        const r = await c.query<Row>(
          `SELECT m.id::text AS "mealId", m.name AS meal, to_char(m.at_time, 'HH24:MI') AS "atTime", $2::text AS "onDate",
                  f.rating, f.comment
             FROM hostel_meals m
             LEFT JOIN hostel_meal_feedback f ON f.meal_id = m.id AND f.on_date = $2::date AND f.student_id = $1 AND f.by_user = app.current_user_id()
            WHERE m.hostel_id = app.hostel_of($1, $2::date) AND m.active
            ORDER BY m.at_time`,
          [studentId, d],
        );
        out.push(...r.rows.filter((x) => slotOf(d, String(x.atTime)) <= Date.now()));
      }
      return { data: out };
    });
  }

  /** A family rates a meal its child had in the last week (once per meal and day; a later rating replaces it). */
  async saveFeedback(ctx: RequestContext, dto: FeedbackDto) {
    await this.family(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = (
        await c.query<{ ok: boolean; at: string }>(
          `SELECT m.hostel_id = app.hostel_of($1, $3::date) AS ok, to_char(m.at_time, 'HH24:MI') AS at
             FROM hostel_meals m WHERE m.id = $2`,
          [dto.studentId, dto.mealId, dto.onDate],
        )
      ).rows[0];
      if (!m?.ok)
        throw new DomainError('not-found', 'This meal is not of the child’s hostel that day', {
          status: 404,
        });
      if (slotOf(dto.onDate, m.at) > Date.now() || dto.onDate < addDays(istToday(), -7))
        throw new DomainError(
          'hostel.feedback_window',
          'A meal can be rated after it is served, up to a week later',
          { status: 422 },
        );
      await c.query(
        `INSERT INTO hostel_meal_feedback (school_id, meal_id, on_date, student_id, rating, comment, by_user)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
         ON CONFLICT (meal_id, on_date, student_id, by_user)
         DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
        [dto.mealId, dto.onDate, dto.studentId, dto.rating, dto.comment ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.meal.feedback',
        entityType: 'hostel_meal',
        entityId: dto.mealId,
        after: { onDate: dto.onDate, rating: dto.rating },
      });
      return { ok: true };
    });
  }

  /** The ratings of a period (the last 7 days by default): each meal's average, and the comments. */
  async feedback(ctx: RequestContext, q: FeedbackQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { only } = await this.pick(ctx, c, q.hostelId);
      const to = q.to ?? istToday();
      const from = q.from ?? addDays(to, -6);
      const args = [q.hostelId ?? null, only, from, to];
      const meals = await c.query<Row>(
        `SELECT h.name AS hostel, m.name AS meal, to_char(m.at_time, 'HH24:MI') AS "atTime", count(*)::int AS ratings,
                round(avg(f.rating)::numeric, 1)::float AS average,
                array_agg(f.rating) AS spread
           FROM hostel_meal_feedback f JOIN hostel_meals m ON m.id = f.meal_id JOIN hostels h ON h.id = m.hostel_id
          WHERE ($1::bigint IS NULL OR h.id = $1) AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
            AND f.on_date BETWEEN $3::date AND $4::date
          GROUP BY h.name, m.name, m.at_time ORDER BY h.name, m.at_time`,
        args,
      );
      const comments = await c.query<Row>(
        `SELECT f.on_date::text AS "onDate", h.name AS hostel, m.name AS meal, f.rating, f.comment, st.display_name AS pupil,
                st.admission_no AS "admissionNo"
           FROM hostel_meal_feedback f JOIN hostel_meals m ON m.id = f.meal_id JOIN hostels h ON h.id = m.hostel_id
           JOIN students st ON st.id = f.student_id
          WHERE ($1::bigint IS NULL OR h.id = $1) AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
            AND f.on_date BETWEEN $3::date AND $4::date AND f.comment IS NOT NULL
          ORDER BY f.on_date DESC, f.updated_at DESC LIMIT 100`,
        args,
      );
      return {
        from,
        to,
        meals: meals.rows.map((x) => {
          const spread = [1, 2, 3, 4, 5].map(
            (n) => (x.spread as number[]).filter((r) => r === n).length,
          );
          return { ...x, spread };
        }),
        comments: comments.rows,
      };
    });
  }
}
