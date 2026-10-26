import { Injectable } from '@nestjs/common';
import { LAYOUT_TYPES, type AdmissionFormDef, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { AdmissionFormsService } from './forms.service';
import { pointRulesOf } from './points-rules';
import type { PointRuleInput, SessionPointsDto } from './setup.dto';

/** Questions a criterion can test: those that hold an answer, not headings, files or mark sheets. */
const NOT_ASKABLE = new Set(['file', 'photo', 'marks', 'subjects', 'agree', 'address_same']);

/**
 * Merit points of an admission session (docs/design/40, part 2): one list for the session, and a class
 * may keep its own. Criteria test the answers of the classes' forms; part 3 works the points out.
 */
@Injectable()
export class AdmissionPointsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly forms: AdmissionFormsService,
    private readonly core: AdmissionCoreService,
  ) {}

  private async cycleWith(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    const r = await c.query<{ status: string }>(
      `SELECT status::text FROM admission_cycles WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    return r.rows[0];
  }

  rulesWith(c: PoolClient, cycleId: string) {
    return pointRulesOf(c, cycleId);
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.cycleWith(c, id);
      const rules = await this.rulesWith(c, id);
      const lines = await c.query<{
        class_id: string;
        class_name: string;
        form_id: string | null;
        form_name: string | null;
        def: AdmissionFormDef | null;
        own_points: boolean;
        points_max: string | null;
      }>(
        `SELECT k.class_id::text, cl.name AS class_name, k.form_id::text, f.name AS form_name, f.def, k.own_points, k.points_max::text
           FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id LEFT JOIN admission_forms f ON f.id = k.form_id
          WHERE k.cycle_id = $1 ORDER BY cl.display_order, cl.name`,
        [id],
      );
      // the questions of the session's forms, each with the forms that ask it and its choices
      const options = await this.forms.optionsWith(c);
      const fields = new Map<
        string,
        { key: string; label: string; type: string; values: string[]; forms: string[] }
      >();
      const seen = new Set<string>();
      // document questions, for a criterion that needs its proof uploaded (docs/design/48)
      const proofs = new Map<string, string>();
      for (const l of lines.rows) {
        if (!l.form_id || !l.def || seen.has(l.form_id)) continue;
        seen.add(l.form_id);
        for (const f of l.def.fields) {
          if (f.type === 'file' && !proofs.has(f.key)) proofs.set(f.key, f.label);
          if (LAYOUT_TYPES.includes(f.type) || NOT_ASKABLE.has(f.type)) continue;
          const have = fields.get(f.key);
          if (have) {
            have.forms.push(l.form_id);
            continue;
          }
          const values =
            f.type === 'siblings'
              ? ['0', '1', '2', '3']
              : (AdmissionFormsService.optionsOf(f, options) ?? []).slice(0, 200);
          fields.set(f.key, {
            key: f.key,
            label: f.label,
            type: f.type,
            values,
            forms: [l.form_id],
          });
        }
      }
      const max = await c.query<{ max: string | null }>(
        `SELECT points_max::text AS max FROM admission_cycles WHERE id = $1`,
        [id],
      );
      return {
        editable: y.status !== 'closed',
        session: rules.session,
        max: max.rows[0]?.max ? Number(max.rows[0].max) : null,
        classes: lines.rows.map((x) => ({
          classId: x.class_id,
          className: x.class_name,
          formId: x.form_id,
          formName: x.form_name,
          own: x.own_points,
          rules: rules.byClass(x.class_id),
          max: x.points_max !== null ? Number(x.points_max) : null,
        })),
        fields: [...fields.values()],
        proofs: [...proofs.entries()].map(([key, label]) => ({ key, label })),
      };
    });
  }

  async save(ctx: RequestContext, id: string, dto: SessionPointsDto) {
    const recalculated = await this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.cycleWith(c, id);
      if (y.status === 'closed')
        throw new DomainError(
          'admissions.session_closed',
          'The session is closed: its merit points can no longer change',
          { status: 409 },
        );
      const lines = await c.query<{ class_id: string }>(
        `SELECT class_id::text FROM admission_class_criteria WHERE cycle_id = $1`,
        [id],
      );
      const classIds = new Set(lines.rows.map((x) => x.class_id));
      for (const k of dto.classes)
        if (!classIds.has(k.classId))
          throw new DomainError('validation-failed', 'A class is not in this session', {
            status: 400,
          });
      const before = await this.rulesWith(c, id);
      await c.query(`DELETE FROM admission_point_rules WHERE cycle_id = $1`, [id]);
      const put = async (classId: string | null, list: PointRuleInput[]) => {
        for (const [i, r] of list.entries())
          await c.query(
            `INSERT INTO admission_point_rules (school_id, cycle_id, class_id, name, logic, conditions, points, sort_order, updated_by, kind, spec, cap)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6, $7, app.current_user_id(), $8, $9::jsonb, $10)`,
            [
              id,
              classId,
              r.name,
              r.logic,
              JSON.stringify(r.conditions),
              r.points.toFixed(2),
              i,
              r.kind,
              JSON.stringify(r.spec ?? {}),
              r.cap ?? null,
            ],
          );
      };
      await put(null, dto.session);
      await c.query(`UPDATE admission_cycles SET points_max = $2 WHERE id = $1`, [
        id,
        dto.max ?? null,
      ]);
      for (const k of dto.classes) {
        await c.query(
          `UPDATE admission_class_criteria SET own_points = $3, points_max = $4 WHERE cycle_id = $1 AND class_id = $2`,
          [id, k.classId, k.own, k.own ? (k.max ?? null) : null],
        );
        // a class that goes by the session's list keeps no list of its own
        if (k.own) await put(k.classId, k.rules);
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.points',
        entityType: 'admission_cycles',
        entityId: id,
        before: { session: before.session.map((r) => `${r.name} ${r.points}`) },
        after: {
          session: dto.session.map((r) => `${r.name} ${r.points}`),
          ownLists: dto.classes.filter((k) => k.own).length,
        },
      });
      // registrations whose points the office has not confirmed follow the new criteria
      const open = await c.query<{ id: string }>(
        `SELECT id::text FROM applications
          WHERE cycle_id = $1 AND status <> 'draft' AND points_confirmed_at IS NULL ORDER BY id`,
        [id],
      );
      for (const a of open.rows) await this.core.refreshPoints(c, a.id);
      return open.rows.length;
    });
    return { ...(await this.get(ctx, id)), recalculated };
  }
}
