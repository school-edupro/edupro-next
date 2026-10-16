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
import type {
  MealOrderDto,
  MenuCloneDto,
  MenuCopyDto,
  MenuCycleDto,
  MenuFileDto,
  MenuTemplateQueryDto,
  MessMealDto,
} from './hostel-mess.dto';
import { dietLists } from './hostel-diets.service';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';

type Row = Record<string, unknown>;

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Monday of the week of a day. */
export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, as the menu is read. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** The week of a rotating cycle a Monday falls in (1..weeks). */
export const cycleWeekOf = (monday: string, start: string, weeks: number) => {
  const n = Math.round(
    (Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604_800_000,
  );
  return (((n % weeks) + weeks) % weeks) + 1;
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
              // the school's meal of this name (made when new), so every hostel's meal is one of the school's
              `WITH m AS (
                 INSERT INTO mess_meals (school_id, name, at_time, sort_order)
                 SELECT app.current_school_id(), $2, $3::time, COALESCE((SELECT max(sort_order) FROM mess_meals), 0) + 1
                  WHERE NOT EXISTS (SELECT 1 FROM mess_meals WHERE lower(btrim(name)) = lower(btrim($2)))
                 RETURNING id)
               INSERT INTO hostel_meals (school_id, hostel_id, name, at_time, active, mess_meal_id)
               VALUES (app.current_school_id(), $1, $2, $3::time, $4,
                       COALESCE((SELECT id FROM m), (SELECT id FROM mess_meals WHERE lower(btrim(name)) = lower(btrim($2)))))
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
  private async cycle(c: PoolClient, hostelId: string) {
    const h = (
      await c.query<{ name: string; weeks: number; start: string }>(
        `SELECT name, menu_cycle_weeks AS weeks, menu_cycle_start::text AS start FROM hostels WHERE id = $1`,
        [hostelId],
      )
    ).rows[0];
    if (!h) throw new DomainError('not-found', 'Hostel not found', { status: 404 });
    return { name: h.name, weeks: Number(h.weeks), start: h.start };
  }

  private async weekOf(c: PoolClient, hostelId: string, weekOf?: string) {
    const monday = mondayOf(weekOf ?? istToday());
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const cy = await this.cycle(c, hostelId);
    const cycleWeek = cycleWeekOf(monday, cy.start, cy.weeks);
    const meals = await c.query<{ id: string; name: string; at_time: string }>(
      `SELECT id::text, name, to_char(at_time, 'HH24:MI') AS at_time FROM hostel_meals WHERE hostel_id = $1 AND active ORDER BY at_time`,
      [hostelId],
    );
    const base = await c.query<{ meal_id: string; weekday: number; items: string }>(
      `SELECT meal_id::text, weekday, items FROM hostel_menu WHERE meal_id = ANY ($1::bigint[]) AND cycle_week = $2`,
      [meals.rows.map((m) => m.id), cycleWeek],
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
      hostel: { id: hostelId, name: cy.name },
      /** The rotating cycle: this week is week {cycleWeek} of {cycleWeeks}. */
      cycleWeeks: cy.weeks,
      cycleStart: cy.start,
      cycleWeek,
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
            `INSERT INTO hostel_menu (school_id, meal_id, cycle_week, weekday, items, updated_by)
             VALUES (app.current_school_id(), $1, $4, $2, $3, app.current_user_id())
             ON CONFLICT (meal_id, cycle_week, weekday) DO UPDATE SET items = EXCLUDED.items, updated_at = now(), updated_by = app.current_user_id()`,
            [e.mealId, e.weekday, e.items, dto.cycleWeek],
          );
        else
          await c.query(
            `DELETE FROM hostel_menu WHERE meal_id = $1 AND weekday = $2 AND cycle_week = $3`,
            [e.mealId, e.weekday, dto.cycleWeek],
          );
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.save',
        entityType: 'hostel',
        entityId: dto.hostelId,
        after: { entries: dto.entries.length, cycleWeek: dto.cycleWeek },
      });
      return this.templateOf(c, dto.hostelId, dto.cycleWeek);
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

  // ---- meals of the school (0161) ----------------------------------------------------------------------------
  /** The school's meals, each with the hostels that serve it (own time, whether it has a menu or marks). */
  async messMeals(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const hostels = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM hostels WHERE status = 'active' AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[])) ORDER BY name`,
        [only],
      );
      const meals = await c.query<Row>(
        `SELECT m.id::text, m.name, to_char(m.at_time, 'HH24:MI') AS "atTime", m.sort_order AS "sortOrder", m.active,
                COALESCE(json_agg(json_build_object(
                  'mealId', hm.id::text, 'hostelId', hm.hostel_id::text, 'hostel', h.name, 'atTime', to_char(hm.at_time, 'HH24:MI'),
                  'active', hm.active,
                  'used', EXISTS (SELECT 1 FROM hostel_menu x WHERE x.meal_id = hm.id)
                       OR EXISTS (SELECT 1 FROM hostel_meal_marks x WHERE x.meal_id = hm.id)
                       OR EXISTS (SELECT 1 FROM hostel_menu_changes x WHERE x.meal_id = hm.id)
                       OR EXISTS (SELECT 1 FROM hostel_meal_feedback x WHERE x.meal_id = hm.id)) ORDER BY h.name)
                  FILTER (WHERE hm.id IS NOT NULL), '[]') AS hostels
           FROM mess_meals m LEFT JOIN hostel_meals hm ON hm.mess_meal_id = m.id LEFT JOIN hostels h ON h.id = hm.hostel_id
          GROUP BY m.id ORDER BY m.sort_order, m.at_time, m.name`,
      );
      return { meals: meals.rows, hostels: hostels.rows };
    });
  }

  /** Make or change a school meal and the hostels that serve it (a hostel left out stops serving it). */
  async saveMessMeal(ctx: RequestContext, dto: MessMealDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM mess_meals WHERE lower(btrim(name)) = lower(btrim($1)) AND ($2::bigint IS NULL OR id <> $2)`,
        [dto.name, id ?? null],
      );
      if (dup.rowCount)
        throw new DomainError('hostel.meal_taken', `There is already a meal called ${dto.name}`, {
          status: 409,
        });
      const saved = id
        ? await c.query<{ id: string }>(
            `UPDATE mess_meals SET name = $2, at_time = $3::time, active = $4, updated_at = now(), updated_by = app.current_user_id()
              WHERE id = $1 RETURNING id::text`,
            [id, dto.name, dto.atTime, dto.active],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO mess_meals (school_id, name, at_time, active, sort_order, updated_by)
             VALUES (app.current_school_id(), $1, $2::time, $3, COALESCE((SELECT max(sort_order) FROM mess_meals), 0) + 1, app.current_user_id())
             RETURNING id::text`,
            [dto.name, dto.atTime, dto.active],
          );
      const mealId = saved.rows[0]?.id;
      if (!mealId) throw new DomainError('not-found', 'Meal not found', { status: 404 });
      const ticked = new Set(dto.hostels.map((h) => h.hostelId));
      for (const h of dto.hostels) {
        try {
          await c.query(
            `INSERT INTO hostel_meals (school_id, hostel_id, name, at_time, active, mess_meal_id)
             VALUES (app.current_school_id(), $1, $2, COALESCE($3::time, $4::time), $5, $6)
             ON CONFLICT (hostel_id, mess_meal_id) WHERE mess_meal_id IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name, at_time = EXCLUDED.at_time, active = EXCLUDED.active`,
            [h.hostelId, dto.name, h.atTime ?? null, dto.atTime, dto.active, mealId],
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new DomainError(
              'hostel.meal_taken',
              `A hostel already has another meal called ${dto.name}`,
              { status: 409 },
            );
          throw e;
        }
      }
      // a hostel no longer ticked: its meal goes when never used, else it is switched off (history kept)
      const old = await c.query<{ id: string; hostel_id: string; used: boolean }>(
        `SELECT hm.id::text, hm.hostel_id::text, EXISTS (SELECT 1 FROM hostel_menu x WHERE x.meal_id = hm.id)
                OR EXISTS (SELECT 1 FROM hostel_meal_marks x WHERE x.meal_id = hm.id)
                OR EXISTS (SELECT 1 FROM hostel_menu_changes x WHERE x.meal_id = hm.id)
                OR EXISTS (SELECT 1 FROM hostel_meal_feedback x WHERE x.meal_id = hm.id) AS used
           FROM hostel_meals hm WHERE hm.mess_meal_id = $1`,
        [mealId],
      );
      for (const o of old.rows.filter((x) => !ticked.has(x.hostel_id)))
        if (o.used) await c.query(`UPDATE hostel_meals SET active = false WHERE id = $1`, [o.id]);
        else await c.query(`DELETE FROM hostel_meals WHERE id = $1`, [o.id]);
      await this.audit.stage(ctx, c, {
        action: id ? 'hostel.mess_meal.update' : 'hostel.mess_meal.create',
        entityType: 'mess_meal',
        entityId: mealId,
        after: dto,
      });
      return { id: mealId };
    });
  }

  /** A meal that was never served (no menu, marks, changes or feedback) can be deleted; else switch it off. */
  async deleteMessMeal(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ used: boolean; name: string }>(
        `SELECT m.name, EXISTS (SELECT 1 FROM hostel_meals hm WHERE hm.mess_meal_id = m.id AND (
                  EXISTS (SELECT 1 FROM hostel_menu x WHERE x.meal_id = hm.id)
                  OR EXISTS (SELECT 1 FROM hostel_meal_marks x WHERE x.meal_id = hm.id)
                  OR EXISTS (SELECT 1 FROM hostel_menu_changes x WHERE x.meal_id = hm.id)
                  OR EXISTS (SELECT 1 FROM hostel_meal_feedback x WHERE x.meal_id = hm.id))) AS used
           FROM mess_meals m WHERE m.id = $1`,
        [id],
      );
      const m = r.rows[0];
      if (!m) throw new DomainError('not-found', 'Meal not found', { status: 404 });
      if (m.used)
        throw new DomainError(
          'hostel.meal_used',
          `${m.name} has a menu, marks or feedback: switch it off instead of deleting it`,
          { status: 409 },
        );
      await c.query(`DELETE FROM hostel_meals WHERE mess_meal_id = $1`, [id]);
      await c.query(`DELETE FROM mess_meals WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.mess_meal.delete',
        entityType: 'mess_meal',
        entityId: id,
        before: { name: m.name },
      });
      return { ok: true };
    });
  }

  async orderMeals(ctx: RequestContext, dto: MealOrderDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const [i, id] of dto.ids.entries())
        await c.query(`UPDATE mess_meals SET sort_order = $2 WHERE id = $1`, [id, i + 1]);
      return { ok: true };
    });
  }

  // ---- the rotating menu ---------------------------------------------------------------------------------------
  async saveCycle(ctx: RequestContext, dto: MenuCycleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, dto.hostelId);
      if (mondayOf(dto.start) !== dto.start)
        throw new DomainError('validation-failed', 'The cycle starts on a Monday', { status: 400 });
      await c.query(
        `UPDATE hostels SET menu_cycle_weeks = $2, menu_cycle_start = $3::date WHERE id = $1`,
        [dto.hostelId, dto.weeks, dto.start],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.cycle',
        entityType: 'hostel',
        entityId: dto.hostelId,
        after: dto,
      });
      return this.templateOf(c, dto.hostelId, 1);
    });
  }

  /** One week of the cycle as it repeats: each meal on each weekday (Monday first). */
  private async templateOf(c: PoolClient, hostelId: string, week: number) {
    const cy = await this.cycle(c, hostelId);
    const meals = await c.query<{ id: string; name: string; at: string }>(
      `SELECT id::text, name, to_char(at_time, 'HH24:MI') AS at FROM hostel_meals WHERE hostel_id = $1 AND active ORDER BY at_time`,
      [hostelId],
    );
    const items = await c.query<{ meal_id: string; weekday: number; items: string }>(
      `SELECT meal_id::text, weekday, items FROM hostel_menu WHERE meal_id = ANY ($1::bigint[]) AND cycle_week = $2`,
      [meals.rows.map((m) => m.id), week],
    );
    const nowWeek = cycleWeekOf(mondayOf(istToday()), cy.start, cy.weeks);
    return {
      hostel: { id: hostelId, name: cy.name },
      cycleWeeks: cy.weeks,
      cycleStart: cy.start,
      week: Math.min(week, 4),
      /** The cycle week running now. */
      thisWeek: nowWeek,
      meals: meals.rows.map((m) => ({ id: m.id, name: m.name, atTime: m.at })),
      days: WEEK.map((wd) => ({
        weekday: wd,
        day: DAY_NAME[wd]!,
        items: meals.rows.map(
          (m) => items.rows.find((x) => x.meal_id === m.id && x.weekday === wd)?.items ?? '',
        ),
      })),
    };
  }

  async template(ctx: RequestContext, q: MenuTemplateQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, q.hostelId);
      return this.templateOf(c, q.hostelId, q.week);
    });
  }

  /**
   * Copy one hostel's menu (every week of its cycle) to other hostels, meal by meal of the school (a
   * target hostel that does not serve a meal is left out of it). Replace: the target's menu and cycle
   * become the source's; fill: only empty cells are filled.
   */
  async cloneMenu(ctx: RequestContext, dto: MenuCloneDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, dto.fromHostelId);
      const targets = dto.toHostelIds.filter((h) => h !== dto.fromHostelId);
      if (!targets.length)
        throw new DomainError('validation-failed', 'Pick another hostel to copy to', {
          status: 400,
        });
      const src = await this.cycle(c, dto.fromHostelId);
      let copied = 0;
      const missing: string[] = [];
      for (const to of targets) {
        await this.mine(ctx, c, to);
        if (dto.mode === 'replace') {
          await c.query(
            `UPDATE hostels SET menu_cycle_weeks = $2, menu_cycle_start = $3::date WHERE id = $1`,
            [to, src.weeks, src.start],
          );
          await c.query(
            `DELETE FROM hostel_menu WHERE meal_id IN (SELECT id FROM hostel_meals WHERE hostel_id = $1)`,
            [to],
          );
        }
        const r = await c.query<{ n: number }>(
          `WITH ins AS (
             INSERT INTO hostel_menu (school_id, meal_id, cycle_week, weekday, items, updated_by)
             SELECT app.current_school_id(), tm.id, sm.cycle_week, sm.weekday, sm.items, app.current_user_id()
               FROM hostel_menu sm JOIN hostel_meals fm ON fm.id = sm.meal_id AND fm.hostel_id = $1
               JOIN hostel_meals tm ON tm.hostel_id = $2 AND tm.mess_meal_id = fm.mess_meal_id
             ON CONFLICT (meal_id, cycle_week, weekday) DO NOTHING
             RETURNING 1)
           SELECT count(*)::int AS n FROM ins`,
          [dto.fromHostelId, to],
        );
        copied += r.rows[0]!.n;
        const gap = await c.query<{ name: string; hostel: string }>(
          `SELECT DISTINCT fm.name, h.name AS hostel FROM hostel_menu sm JOIN hostel_meals fm ON fm.id = sm.meal_id AND fm.hostel_id = $1
             JOIN hostels h ON h.id = $2
            WHERE NOT EXISTS (SELECT 1 FROM hostel_meals tm WHERE tm.hostel_id = $2 AND tm.mess_meal_id = fm.mess_meal_id)`,
          [dto.fromHostelId, to],
        );
        missing.push(...gap.rows.map((g) => `${g.hostel}: ${g.name}`));
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.clone',
        entityType: 'hostel',
        entityId: dto.fromHostelId,
        after: { ...dto, copied },
      });
      return { copied, missing };
    });
  }

  /** Copy a day of a cycle week to other days (any week), or a whole cycle week to other weeks. */
  async copyMenu(ctx: RequestContext, dto: MenuCopyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mine(ctx, c, dto.hostelId);
      const cy = await this.cycle(c, dto.hostelId);
      if ([dto.fromWeek, ...dto.to.map((t) => t.week)].some((w) => w > cy.weeks))
        throw new DomainError(
          'validation-failed',
          `This hostel's menu runs a ${String(cy.weeks)}-week cycle`,
          { status: 400 },
        );
      const pairs: Array<[number, number, number, number]> = [];
      for (const t of dto.to)
        if (dto.fromWeekday !== null && dto.fromWeekday !== undefined)
          pairs.push([dto.fromWeek, dto.fromWeekday, t.week, t.weekday!]);
        else for (const wd of WEEK) pairs.push([dto.fromWeek, wd, t.week, wd]);
      let copied = 0;
      for (const [fw, fd, tw, td] of pairs) {
        if (fw === tw && fd === td) continue;
        // the target cell becomes the source cell (an empty source empties it)
        await c.query(
          `DELETE FROM hostel_menu WHERE cycle_week = $2 AND weekday = $3 AND meal_id IN (SELECT id FROM hostel_meals WHERE hostel_id = $1)`,
          [dto.hostelId, tw, td],
        );
        const r = await c.query(
          `INSERT INTO hostel_menu (school_id, meal_id, cycle_week, weekday, items, updated_by)
           SELECT app.current_school_id(), m.meal_id, $4, $5, m.items, app.current_user_id()
             FROM hostel_menu m JOIN hostel_meals hm ON hm.id = m.meal_id AND hm.hostel_id = $1
            WHERE m.cycle_week = $2 AND m.weekday = $3`,
          [dto.hostelId, fw, fd, tw, td],
        );
        copied += r.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.menu.copy',
        entityType: 'hostel',
        entityId: dto.hostelId,
        after: dto,
      });
      return { copied };
    });
  }

  /** The menu of a week (with that week's one-off changes) as Excel or PDF: meals down, days across. */
  async menuFile(ctx: RequestContext, q: MenuFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.weekOf(c, q.hostelId, q.weekOf);
      const head = await schoolHead(c);
      const dd = (d: string) =>
        new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC',
        });
      const changed = w.days.flatMap((d) =>
        d.meals
          .filter((m) => m.changed)
          .map((m) => `${dd(d.date)} ${m.meal}${m.note ? `: ${m.note}` : ''}`),
      );
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Mess menu',
          details: [
            w.hostel.name,
            `Week of ${dd(w.weekOf)}`,
            w.cycleWeeks > 1
              ? `Week ${String(w.cycleWeek)} of the ${String(w.cycleWeeks)}-week cycle`
              : '',
            generatedOn(),
          ].filter(Boolean),
          legend: changed.length ? `* changed for the day: ${changed.join(' · ')}` : '',
          columns: [
            { label: 'Meal', width: 12 },
            ...w.days.map((d) => ({ label: dd(d.date), width: 20 })),
          ],
          rows: w.meals.map((m) => [
            `${m.name} (${m.atTime})`,
            ...w.days.map((d) => {
              const x = d.meals.find((y) => y.mealId === m.id);
              return x?.items ? `${x.items}${x.changed ? ' *' : ''}` : '—';
            }),
          ]),
          fontSize: 8,
          filename: `mess-menu-${w.weekOf}`,
        },
        q.format,
      );
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
      if (!h?.id) {
        // a child who has left the hostel: when, and up to which month the hostel fee runs
        const left = (
          await c.query<{ on: string; hostel: string; feeUntil: string | null }>(
            `SELECT a.to_date::text AS on, h.name AS hostel, hw.fee_until::text AS "feeUntil"
               FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
               JOIN hostels h ON h.id = r.hostel_id
               LEFT JOIN hostel_withdrawals hw ON hw.allotment_id = a.id AND hw.status = 'completed'
              WHERE a.student_id = $1 AND a.to_date IS NOT NULL AND a.end_reason IN ('vacate', 'withdrawn')
              ORDER BY a.to_date DESC LIMIT 1`,
            [studentId],
          )
        ).rows[0];
        return { hostel: null, week: null, diet: null, left: left ?? null };
      }
      const diet = (
        await c.query(
          `SELECT d.diet, t.name AS "dietName", d.no_onion_garlic AS "noOnionGarlic", d.allergies, d.notes
             FROM hostel_diets d LEFT JOIN mess_diet_types t ON t.code = d.diet WHERE d.student_id = $1`,
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
      allergies: string[] | null;
    }>(
      `SELECT st.id::text AS student_id, st.display_name AS name, st.admission_no,
              COALESCE(bl.name || '-', '') || r.room_no AS room,
              EXISTS (SELECT 1 FROM gate_passes g WHERE g.student_id = st.id AND g.kind IN ('hostel_home', 'hostel_outing')
                         AND g.out_at <= $3::timestamptz AND (g.in_at IS NULL OR g.in_at > $3::timestamptz)) AS away,
              sk.id IS NOT NULL AS skipped, sk.reason,
              d.diet, d.no_onion_garlic, d.allergies, CASE WHEN lower(btrim(COALESCE(st.profile->>'medical_condition', ''))) IN ('', 'na', 'n/a', 'nil', 'none', 'no', '-', '--', 'not applicable') THEN NULL ELSE btrim(st.profile->>'medical_condition') END AS allergy
         FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
         LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
         JOIN students st ON st.id = a.student_id
         LEFT JOIN hostel_meal_skips sk ON sk.mark_id = $4::bigint AND sk.student_id = st.id
         LEFT JOIN hostel_diets d ON d.student_id = st.id
        WHERE r.hostel_id = $1 AND a.from_date <= $2::date AND (a.to_date IS NULL OR a.to_date >= $2::date)
        ORDER BY bl.name NULLS FIRST, r.floor, r.room_no, b.label`,
      [m.hostel_id, on, at, mark?.id ?? null],
    );
    const lists = await dietLists(c);
    const def = lists.types.find((t) => t.isDefault)?.code ?? 'veg';
    const dietName = (code: string) => lists.types.find((t) => t.code === code)?.name ?? code;
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
        diet: x.diet ?? def,
        dietName: dietName(x.diet ?? def),
        noOnionGarlic: x.no_onion_garlic ?? false,
        allergies: x.allergies ?? [],
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

  // ---- diets (the list, upload and export are in HostelDietsService) ------------------------------------
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
      const lists = await dietLists(c);
      if (!lists.types.some((t) => t.code === dto.diet && t.active))
        throw new DomainError('hostel.diet_unknown', `"${dto.diet}" is not a diet type in use`, {
          status: 422,
        });
      const allergies = dto.allergies.map((a) => {
        const hit = lists.allergies.find(
          (x) => x.active && x.name.toLowerCase() === a.toLowerCase(),
        );
        if (!hit)
          throw new DomainError(
            'hostel.allergy_unknown',
            `"${a}" is not on the school's allergy list`,
            {
              status: 422,
            },
          );
        return hit.name;
      });
      await c.query(
        `INSERT INTO hostel_diets (student_id, school_id, diet, no_onion_garlic, notes, allergies, updated_by)
         VALUES ($1, app.current_school_id(), $2, $3, $4, $5::text[], app.current_user_id())
         ON CONFLICT (student_id) DO UPDATE SET diet = EXCLUDED.diet, no_onion_garlic = EXCLUDED.no_onion_garlic,
              notes = EXCLUDED.notes, allergies = EXCLUDED.allergies, updated_at = now(), updated_by = app.current_user_id()`,
        [studentId, dto.diet, dto.noOnionGarlic, dto.notes ?? null, [...new Set(allergies)]],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.diet.save',
        entityType: 'student',
        entityId: studentId,
        after: dto,
      });
      return { studentId, ...dto, allergies };
    });
  }
}
