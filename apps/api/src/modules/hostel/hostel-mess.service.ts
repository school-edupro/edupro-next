import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import {
  HOSTEL_H3,
  type DietDto,
  type MealDto,
  type MealRollQueryDto,
  type MealRollSaveDto,
  type MenuChangeDto,
  type MenuQueryDto,
  type MenuWeekDto,
} from './hostel.dto';
import { HostelService } from './hostel.service';

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Monday of the week of a day. */
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};

/**
 * Hostel module H3, the mess: the meals of each hostel, the repeating weekly menu and one-off changes for
 * a day, who skipped a meal (everyone else holding a bed and not away on leave had it), and the kitchen's
 * diet list — the hostel's diet of each boarder and the allergy written on the student record.
 */
@Injectable()
export class HostelMessService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly hostel: HostelService,
  ) {}

  private async mine(ctx: RequestContext, c: PoolClient, hostelId: string) {
    const only = await this.hostel.scope(ctx, c);
    if (only && !only.includes(hostelId))
      throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
        status: 403,
      });
  }

  // ---- meals -------------------------------------------------------------------------------------------------
  async meals(ctx: RequestContext, hostelId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT m.id::text, m.hostel_id::text AS "hostelId", h.name AS hostel, m.name, to_char(m.at_time, 'HH24:MI') AS "atTime", m.active,
                (SELECT k.updated_at FROM hostel_meal_marks k WHERE k.meal_id = m.id AND k.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "markedToday"
           FROM hostel_meals m JOIN hostels h ON h.id = m.hostel_id
          WHERE ($1::bigint IS NULL OR m.hostel_id = $1) AND ($2::bigint[] IS NULL OR m.hostel_id = ANY ($2::bigint[]))
          ORDER BY h.name, m.at_time`,
        [hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  async saveMeal(ctx: RequestContext, dto: MealDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE hostel_meals SET name = $2, at_time = $3::time, active = $4 WHERE id = $1 RETURNING id::text`,
              [id, dto.name, dto.atTime, dto.active],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO hostel_meals (school_id, hostel_id, name, at_time, active) VALUES (app.current_school_id(), $1, $2, $3::time, $4)
               RETURNING id::text`,
              [dto.hostelId, dto.name, dto.atTime, dto.active],
            );
        if (!r.rows[0]) throw new DomainError('not-found', 'Meal not found', { status: 404 });
        await this.audit.stage(ctx, c, {
          action: 'hostel.meal.save',
          entityType: 'hostel_meal',
          entityId: r.rows[0].id,
          after: dto,
        });
        return { id: r.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'hostel.meal_taken',
            `This hostel already has a meal called ${dto.name}`,
            { status: 409 },
          );
        throw e;
      }
    });
  }

  // ---- menu --------------------------------------------------------------------------------------------------
  /** The week (Monday on) of a hostel: each day, each active meal with what it serves and whether it changed. */
  private async weekOf(c: PoolClient, hostelId: string, weekOf?: string) {
    const monday = mondayOf(weekOf ?? istToday());
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const meals = await c.query<{ id: string; name: string; at_time: string }>(
      `SELECT id::text, name, to_char(at_time, 'HH24:MI') AS at_time FROM hostel_meals WHERE hostel_id = $1 AND active ORDER BY at_time`,
      [hostelId],
    );
    const base = await c.query<{ meal_id: string; weekday: number; items: string }>(
      `SELECT meal_id::text, weekday, items FROM hostel_menu WHERE meal_id = ANY ($1::bigint[])`,
      [meals.rows.map((m) => m.id)],
    );
    const changes = await c.query<{
      meal_id: string;
      on_date: string;
      items: string;
      note: string | null;
    }>(
      `SELECT meal_id::text, on_date::text, items, note FROM hostel_menu_changes
        WHERE meal_id = ANY ($1::bigint[]) AND on_date BETWEEN $2::date AND $3::date`,
      [meals.rows.map((m) => m.id), days[0], days[6]],
    );
    return {
      weekOf: monday,
      meals: meals.rows.map((m) => ({ id: m.id, name: m.name, atTime: m.at_time })),
      days: days.map((d) => {
        const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
        return {
          date: d,
          weekday: wd,
          meals: meals.rows.map((m) => {
            const ch = changes.rows.find((x) => x.meal_id === m.id && x.on_date === d);
            const b = base.rows.find((x) => x.meal_id === m.id && x.weekday === wd);
            return {
              mealId: m.id,
              meal: m.name,
              atTime: m.at_time,
              items: ch?.items ?? b?.items ?? null,
              weekly: b?.items ?? null,
              changed: !!ch,
              note: ch?.note ?? null,
            };
          }),
        };
      }),
    };
  }

  async menu(ctx: RequestContext, q: MenuQueryDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.weekOf(c, q.hostelId, q.weekOf));
  }

  async saveWeek(ctx: RequestContext, dto: MenuWeekDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, dto.hostelId);
      const own = await c.query<{ id: string }>(
        `SELECT id::text FROM hostel_meals WHERE hostel_id = $1`,
        [dto.hostelId],
      );
      const ids = new Set(own.rows.map((x) => x.id));
      if (dto.entries.some((e) => !ids.has(e.mealId)))
        throw new DomainError('validation-failed', 'A meal is not of this hostel', { status: 422 });
      for (const e of dto.entries)
        if (e.items)
          await c.query(
            `INSERT INTO hostel_menu (school_id, meal_id, weekday, items, updated_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
             ON CONFLICT (meal_id, weekday) DO UPDATE SET items = EXCLUDED.items, updated_at = now(), updated_by = app.current_user_id()`,
            [e.mealId, e.weekday, e.items],
          );
        else
          await c.query(`DELETE FROM hostel_menu WHERE meal_id = $1 AND weekday = $2`, [
            e.mealId,
            e.weekday,
          ]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.save',
        entityType: 'hostel',
        entityId: dto.hostelId,
        after: { entries: dto.entries.length },
      });
      return this.weekOf(c, dto.hostelId);
    });
  }

  async saveChange(ctx: RequestContext, dto: MenuChangeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = (
        await c.query<{ hostel_id: string }>(
          `SELECT hostel_id::text FROM hostel_meals WHERE id = $1`,
          [dto.mealId],
        )
      ).rows[0];
      if (!m) throw new DomainError('not-found', 'Meal not found', { status: 404 });
      await this.mine(ctx, c, m.hostel_id);
      if (dto.items)
        await c.query(
          `INSERT INTO hostel_menu_changes (school_id, meal_id, on_date, items, note, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (meal_id, on_date) DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = now(),
                updated_by = app.current_user_id()`,
          [dto.mealId, dto.onDate, dto.items, dto.note ?? null],
        );
      else
        await c.query(`DELETE FROM hostel_menu_changes WHERE meal_id = $1 AND on_date = $2`, [
          dto.mealId,
          dto.onDate,
        ]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.change',
        entityType: 'hostel_meal',
        entityId: dto.mealId,
        after: dto,
      });
      return this.weekOf(c, m.hostel_id, dto.onDate);
    });
  }

  /** This week's menu of the hostel a child boards in, with the child's diet (parent portal). */
  async familyMenu(ctx: RequestContext, studentId: string, weekOf?: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = (
        await c.query<{ id: string | null; name: string | null }>(
          `SELECT h.id::text, h.name FROM hostels h WHERE h.id = app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
          [studentId],
        )
      ).rows[0];
      if (!h?.id) return { hostel: null, week: null, diet: null };
      const diet = (
        await c.query(
          `SELECT diet, no_onion_garlic AS "noOnionGarlic", notes FROM hostel_diets WHERE student_id = $1`,
          [studentId],
        )
      ).rows[0];
      return {
        hostel: { id: h.id, name: h.name },
        week: await this.weekOf(c, h.id, weekOf),
        diet: diet ?? null,
      };
    });
  }

  // ---- meal attendance -------------------------------------------------------------------------------------------
  /** The boarders of the meal's hostel on the day: away on leave at the meal's time, skipped, diet and allergy. */
  private async roll(c: PoolClient, mealId: string, on: string) {
    const m = (
      await c.query<{
        id: string;
        hostel_id: string;
        hostel: string;
        name: string;
        at_time: string;
      }>(
        `SELECT m.id::text, m.hostel_id::text, h.name AS hostel, m.name, to_char(m.at_time, 'HH24:MI') AS at_time
           FROM hostel_meals m JOIN hostels h ON h.id = m.hostel_id WHERE m.id = $1`,
        [mealId],
      )
    ).rows[0];
    if (!m) throw new DomainError('not-found', 'Meal not found', { status: 404 });
    const mark = (
      await c.query<{ id: string; served: number; updated_at: string }>(
        `SELECT id::text, served, updated_at FROM hostel_meal_marks WHERE meal_id = $1 AND on_date = $2`,
        [mealId, on],
      )
    ).rows[0];
    const slot = `${on}T${m.at_time}:00+05:30`;
    const at = on === istToday() && Date.now() > Date.parse(slot) ? new Date().toISOString() : slot;
    const rows = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      room: string;
      away: boolean;
      skipped: boolean;
      reason: string | null;
      diet: string | null;
      no_onion_garlic: boolean | null;
      allergy: string | null;
    }>(
      `SELECT st.id::text AS student_id, st.display_name AS name, st.admission_no,
              COALESCE(bl.name || '-', '') || r.room_no AS room,
              EXISTS (SELECT 1 FROM gate_passes g WHERE g.student_id = st.id AND g.kind IN ('hostel_home', 'hostel_outing')
                         AND g.out_at <= $3::timestamptz AND (g.in_at IS NULL OR g.in_at > $3::timestamptz)) AS away,
              sk.id IS NOT NULL AS skipped, sk.reason,
              d.diet, d.no_onion_garlic, CASE WHEN lower(btrim(COALESCE(st.profile->>'medical_condition', ''))) IN ('', 'na', 'n/a', 'nil', 'none', 'no', '-', '--', 'not applicable') THEN NULL ELSE btrim(st.profile->>'medical_condition') END AS allergy
         FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
         LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
         JOIN students st ON st.id = a.student_id
         LEFT JOIN hostel_meal_skips sk ON sk.mark_id = $4::bigint AND sk.student_id = st.id
         LEFT JOIN hostel_diets d ON d.student_id = st.id
        WHERE r.hostel_id = $1 AND a.from_date <= $2::date AND (a.to_date IS NULL OR a.to_date >= $2::date)
        ORDER BY bl.name NULLS FIRST, r.floor, r.room_no, b.label`,
      [m.hostel_id, on, at, mark?.id ?? null],
    );
    return {
      meal: { id: m.id, hostelId: m.hostel_id, hostel: m.hostel, name: m.name, atTime: m.at_time },
      on,
      marked: mark ? { at: mark.updated_at, served: mark.served } : null,
      pupils: rows.rows.map((x) => ({
        studentId: x.student_id,
        name: x.name,
        admissionNo: x.admission_no,
        room: x.room,
        away: x.away,
        skipped: x.skipped,
        reason: x.reason,
        diet: x.diet ?? 'veg',
        noOnionGarlic: x.no_onion_garlic ?? false,
        allergy: x.allergy,
      })),
    };
  }

  async mealRoll(ctx: RequestContext, q: MealRollQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.roll(c, q.mealId, q.on ?? istToday());
      await this.mine(ctx, c, r.meal.hostelId);
      return r;
    });
  }

  async saveMealRoll(ctx: RequestContext, dto: MealRollSaveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.on > istToday())
        throw new DomainError('hostel.meal_future', 'A meal cannot be marked for a later day', {
          status: 422,
        });
      const r = await this.roll(c, dto.mealId, dto.on);
      await this.mine(ctx, c, r.meal.hostelId);
      const here = new Map(r.pupils.map((p) => [p.studentId, p]));
      if (dto.skips.some((s) => !here.has(s.studentId)))
        throw new DomainError(
          'hostel.meal_stranger',
          'A pupil does not hold a bed in this hostel then',
          { status: 422 },
        );
      const skips = dto.skips.filter((s) => !here.get(s.studentId)!.away);
      const served = r.pupils.filter((p) => !p.away).length - skips.length;
      const mk = await c.query<{ id: string }>(
        `INSERT INTO hostel_meal_marks (school_id, meal_id, on_date, served, taken_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
         ON CONFLICT (meal_id, on_date) DO UPDATE SET served = EXCLUDED.served, taken_by = EXCLUDED.taken_by, updated_at = now()
         RETURNING id::text`,
        [dto.mealId, dto.on, served],
      );
      const markId = mk.rows[0]!.id;
      await c.query(`DELETE FROM hostel_meal_skips WHERE mark_id = $1`, [markId]);
      for (const s of skips)
        await c.query(
          `INSERT INTO hostel_meal_skips (school_id, mark_id, student_id, reason) VALUES (app.current_school_id(), $1, $2, $3)`,
          [markId, s.studentId, s.reason ?? null],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.meal.mark',
        entityType: 'hostel_meal',
        entityId: dto.mealId,
        after: { on: dto.on, served, skipped: skips.length },
      });
      return { served, skipped: skips.length, away: r.pupils.filter((p) => p.away).length };
    });
  }

  // ---- diets --------------------------------------------------------------------------------------------------
  /** The kitchen's list: every boarder of the hostel today with diet, no onion-garlic and the allergy on record. */
  async diets(ctx: RequestContext, hostelId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, hostelId);
      const r = await c.query(
        `SELECT st.id::text AS "studentId", st.display_name AS name, st.admission_no AS "admissionNo",
                COALESCE(bl.name || '-', '') || r.room_no AS room, COALESCE(d.diet, 'veg') AS diet,
                COALESCE(d.no_onion_garlic, false) AS "noOnionGarlic", d.notes,
                CASE WHEN lower(btrim(COALESCE(st.profile->>'medical_condition', ''))) IN ('', 'na', 'n/a', 'nil', 'none', 'no', '-', '--', 'not applicable') THEN NULL ELSE btrim(st.profile->>'medical_condition') END AS allergy, d.student_id IS NOT NULL AS set
           FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
           LEFT JOIN hostel_blocks bl ON bl.id = r.block_id JOIN students st ON st.id = a.student_id
           LEFT JOIN hostel_diets d ON d.student_id = st.id
          WHERE r.hostel_id = $1 AND a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
            AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
          ORDER BY COALESCE(d.diet, 'veg'), st.display_name`,
        [hostelId],
      );
      return r.rows;
    });
  }

  async saveDiet(ctx: RequestContext, studentId: string, dto: DietDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = (
        await c.query<{ id: string | null }>(
          `SELECT app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS id`,
          [studentId],
        )
      ).rows[0];
      if (!h?.id)
        throw new DomainError('hostel.not_boarder', 'The pupil holds no hostel bed today', {
          status: 409,
        });
      await this.mine(ctx, c, h.id);
      await c.query(
        `INSERT INTO hostel_diets (student_id, school_id, diet, no_onion_garlic, notes, updated_by)
         VALUES ($1, app.current_school_id(), $2, $3, $4, app.current_user_id())
         ON CONFLICT (student_id) DO UPDATE SET diet = EXCLUDED.diet, no_onion_garlic = EXCLUDED.no_onion_garlic,
              notes = EXCLUDED.notes, updated_at = now(), updated_by = app.current_user_id()`,
        [studentId, dto.diet, dto.noOnionGarlic, dto.notes ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.diet.save',
        entityType: 'student',
        entityId: studentId,
        after: dto,
      });
      return { studentId, ...dto };
    });
  }
}
