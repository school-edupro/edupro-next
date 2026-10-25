import { messageTag } from './message-tag';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/jobs/outbox.service';
import { QUEUES } from '@edupro/db';
import ExcelJS from 'exceljs';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { enquiryTokenHash } from './enquiry-engine';
import type {
  EnquiryDto,
  EnquiryQueryDto,
  EnquiryReportQueryDto,
  EnquiryUpdateDto,
  FollowUpDto,
  BulkDto,
  DeskLinkDto,
  EnquiryDeskDto,
  EnquiryExportDto,
  InviteDto,
  MoveDto,
  RulesDto,
  PublicEnquiryDto,
  ReplyDto,
  SourcesDto,
  StagesDto,
} from './enquiry.dto';
import { publicTenant } from './public/otp.service';

const DEFAULT_SOURCES = [
  'Walk-in',
  'Phone call',
  'Website',
  'Newspaper',
  'Social media',
  'Hoarding or banner',
  'Parent referral',
  'School event',
  'Other',
];
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export const ENQUIRY_MANAGE = 'admissions.enquiry.manage';

/** The number a family is given for its enquiry (docs/design/43, part 3). */
export const enquiryNo = (id: string) => `ENQ-${id.padStart(6, '0')}`;

/** Who may take enquiries in the school: the users holding the enquiry permission. */
const COUNSELLORS = `SELECT DISTINCT u.id, u.display_name AS name FROM users u
   JOIN user_roles ur ON ur.user_id = u.id AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
   JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_code = 'admissions.enquiry.manage'
  WHERE u.deleted_at IS NULL`;

/**
 * The enquiry desk (docs/design/39, part 8): enquiries from a walk-in, a phone call, the website or a
 * campaign; a counsellor; follow-ups with the next date (the desk shows what is due today and overdue);
 * an invitation to register by email / SMS / WhatsApp with a link that fills the form; the conversion to
 * registration and admission by source and class.
 */
@Injectable()
export class AdmissionEnquiryService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async sourcesWith(c: PoolClient) {
    const n = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admission_enquiry_sources`,
    );
    if (!n.rows[0]?.n)
      for (const [i, name] of DEFAULT_SOURCES.entries())
        await c.query(
          `INSERT INTO admission_enquiry_sources (school_id, name, sort_order) VALUES (app.current_school_id(), $1, $2)`,
          [name, i],
        );
    const r = await c.query<{ id: string; name: string; status: string; used: number }>(
      `SELECT s.id::text, s.name, s.status, (SELECT count(*)::int FROM admission_enquiries e WHERE e.source_id = s.id) AS used
         FROM admission_enquiry_sources s ORDER BY s.sort_order, s.id`,
    );
    return r.rows;
  }

  /** What the desk offers: sources, sessions and classes, counsellors. */
  async meta(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sources = await this.sourcesWith(c);
      const cycles = await c.query<{ id: string; name: string; status: string }>(
        `SELECT id::text, name, status::text FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC LIMIT 10`,
      );
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      );
      const counsellors = await c.query<{ id: string; name: string }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
        `SELECT id::text, name FROM (${COUNSELLORS}) k ORDER BY name LIMIT 300`,
      );
      return {
        sources,
        cycles: cycles.rows,
        classes: classes.rows,
        counsellors: counsellors.rows,
        desk: await this.deskWith(c),
        stages: await this.stagesWith(c),
        rules: await this.rulesWith(c),
        // the roles a lead can escalate to: those whose holders take enquiries
        roles: (
          await c.query<{ code: string; name: string }>(
            `SELECT DISTINCT ON (r.code) r.code, r.name FROM roles r
               JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_code = $1
              WHERE r.deleted_at IS NULL AND (r.school_id IS NULL OR r.school_id = app.current_school_id())
              ORDER BY r.code, r.school_id NULLS LAST`,
            [ENQUIRY_MANAGE],
          )
        ).rows,
      };
    });
  }

  /** How website enquiries are taken: assigned on arrival (to whom) and acknowledged. */
  /**
   * How website enquiries are taken, as before (docs/design/43, part 3): now the "everything else" rule's
   * switch, pool and acknowledgement (docs/design/45, part 3), with the sign-in channels.
   */
  private async deskWith(c: PoolClient) {
    await c.query(
      `INSERT INTO admission_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    const rule = (await this.rulesWith(c)).find((x) => x.isDefault)!;
    const r = await c.query<{ signin_channels: string[] }>(
      `SELECT signin_channels FROM admission_settings WHERE school_id = app.current_school_id()`,
    );
    return {
      autoAssign: rule.autoAssign,
      counsellors: rule.pool,
      acknowledge: rule.acknowledge,
      channels: r.rows[0]!.signin_channels,
    };
  }

  /** The assignment rules (docs/design/45, part 3); a school without one gets "Every enquiry". */
  private async rulesWith(c: PoolClient) {
    await c.query(
      `INSERT INTO admission_enquiry_rules (school_id, name, is_default, sort_order)
       SELECT app.current_school_id(), 'Every enquiry', true, 99
        WHERE NOT EXISTS (SELECT 1 FROM admission_enquiry_rules WHERE is_default AND status = 'active')`,
    );
    const r = await c.query<{
      id: string;
      name: string;
      class_ids: string[];
      source_ids: string[];
      auto_assign: boolean;
      pool: string[];
      pool_roles: string[];
      first_contact_hours: string | null;
      level2_user_id: string | null;
      level2_role: string | null;
      acknowledge: boolean;
      is_default: boolean;
      status: string;
      level2_name: string | null;
      leads: number;
    }>(
      `SELECT r.id::text, r.name, r.class_ids::text[] AS class_ids, r.source_ids::text[] AS source_ids, r.auto_assign,
              r.pool::text[] AS pool, r.pool_roles, r.first_contact_hours::text, r.level2_user_id::text, r.level2_role, r.acknowledge,
              r.is_default, r.status,
              COALESCE((SELECT display_name FROM users WHERE id = r.level2_user_id),
                       (SELECT name FROM roles WHERE code = r.level2_role AND deleted_at IS NULL ORDER BY school_id NULLS LAST LIMIT 1)) AS level2_name,
              (SELECT count(*)::int FROM admission_enquiries e WHERE e.rule_id = r.id) AS leads
         FROM admission_enquiry_rules r ORDER BY r.is_default, r.sort_order, r.id`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      classIds: x.class_ids,
      sourceIds: x.source_ids,
      autoAssign: x.auto_assign,
      pool: x.pool,
      poolRoles: x.pool_roles,
      firstContactHours: x.first_contact_hours === null ? null : Number(x.first_contact_hours),
      level2UserId: x.level2_user_id,
      level2Role: x.level2_role,
      level2Name: x.level2_name,
      acknowledge: x.acknowledge,
      isDefault: x.is_default,
      status: x.status,
      leads: x.leads,
    }));
  }

  /** The rules of the enquiry desk, saved together (docs/design/45, part 3). */
  async saveRules(ctx: RequestContext, dto: RulesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.rulesWith(c);
      const live = dto.rules.filter((x) => x.status === 'active');
      if (live.filter((x) => x.isDefault).length !== 1)
        throw new DomainError(
          'validation-failed',
          'Keep exactly one rule for "everything else" (the enquiries no other rule covers)',
          { status: 400 },
        );
      const people = [
        ...new Set(
          dto.rules.flatMap((x) => [...x.pool, ...(x.level2UserId ? [x.level2UserId] : [])]),
        ),
      ];
      if (people.length) {
        const ok = await c.query<{ id: string }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
          `SELECT id::text FROM (${COUNSELLORS}) k WHERE id = ANY($1::bigint[])`,
          [people],
        );
        if (ok.rows.length !== people.length)
          throw new DomainError(
            'validation-failed',
            'A person chosen cannot take enquiries (no enquiry permission)',
            { status: 400 },
          );
      }
      for (const x of dto.rules) {
        if (x.level2UserId && x.level2Role)
          throw new DomainError('validation-failed', `${x.name}: level 2 is a person or a role`, {
            status: 400,
          });
        for (const code of x.poolRoles) {
          const role = await c.query(
            `SELECT 1 FROM roles WHERE code = $1 AND deleted_at IS NULL AND (school_id IS NULL OR school_id = app.current_school_id())`,
            [code],
          );
          if (!role.rowCount)
            throw new DomainError('validation-failed', `${x.name}: unknown role ${code}`, {
              status: 400,
            });
        }
        if (x.level2Role) {
          const role = await c.query(
            `SELECT 1 FROM roles WHERE code = $1 AND deleted_at IS NULL AND (school_id IS NULL OR school_id = app.current_school_id())`,
            [x.level2Role],
          );
          if (!role.rowCount)
            throw new DomainError('validation-failed', `${x.name}: unknown role`, { status: 400 });
        }
      }
      // the default first, so the "one default" index never sees two at once
      await c.query(`UPDATE admission_enquiry_rules SET is_default = false`);
      const kept: string[] = [];
      for (const [i, x] of dto.rules.entries()) {
        if (x.id && !before.some((b) => b.id === x.id))
          throw new DomainError('not-found', 'Unknown rule', { status: 404 });
        const vals = [
          x.name,
          [...new Set(x.classIds)],
          [...new Set(x.sourceIds)],
          x.autoAssign,
          [...new Set(x.pool)],
          x.firstContactHours,
          x.level2UserId,
          x.level2Role,
          x.acknowledge,
          x.isDefault,
          x.status,
          i + 1,
          [...new Set(x.poolRoles)],
        ];
        if (x.id) {
          await c.query(
            `UPDATE admission_enquiry_rules SET name = $1, class_ids = $2::bigint[], source_ids = $3::bigint[], auto_assign = $4,
                    pool = $5::bigint[], first_contact_hours = $6, level2_user_id = $7, level2_role = $8, acknowledge = $9,
                    is_default = $10, status = $11, sort_order = $12, pool_roles = $13::text[]
              WHERE id = $14`,
            [...vals, x.id],
          );
          kept.push(x.id);
        } else {
          const r = await c.query<{ id: string }>(
            `INSERT INTO admission_enquiry_rules (school_id, name, class_ids, source_ids, auto_assign, pool, first_contact_hours,
                                                  level2_user_id, level2_role, acknowledge, is_default, status, sort_order, pool_roles)
             VALUES (app.current_school_id(), $1, $2::bigint[], $3::bigint[], $4, $5::bigint[], $6, $7, $8, $9, $10, $11, $12, $13::text[])
             RETURNING id::text`,
            vals,
          );
          kept.push(r.rows[0]!.id);
        }
      }
      // a rule left out with leads on it is switched off; an unused one goes
      for (const b of before.filter((b) => !kept.includes(b.id))) {
        if (b.leads)
          await c.query(
            `UPDATE admission_enquiry_rules SET status = 'inactive', is_default = false WHERE id = $1`,
            [b.id],
          );
        else await c.query(`DELETE FROM admission_enquiry_rules WHERE id = $1`, [b.id]);
      }
      const after = await this.rulesWith(c);
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.rules',
        entityType: 'admission_enquiry_rules',
        entityId: ctx.tenant!.schoolId,
        before: before.map((x) => x.name),
        after: after.map((x) => x.name),
      });
      return after;
    });
  }

  /**
   * A lead's rule on arrival (docs/design/45, part 3): the first active rule covering its class and
   * source, else "everything else"; given to the pool in turn (when asked and the rule assigns), and
   * the first contact due within the rule's working hours.
   */
  private async arrive(
    c: PoolClient,
    id: string,
    classId: string | null,
    sourceId: string | null,
    assign: boolean,
  ) {
    const rules = (await this.rulesWith(c)).filter((x) => x.status === 'active');
    const rule =
      rules.find(
        (x) =>
          !x.isDefault &&
          (!x.classIds.length || (classId !== null && x.classIds.includes(classId))) &&
          (!x.sourceIds.length || (sourceId !== null && x.sourceIds.includes(sourceId))),
      ) ?? rules.find((x) => x.isDefault)!;
    await c.query(`UPDATE admission_enquiries SET rule_id = $2 WHERE id = $1`, [id, rule.id]);
    if (assign && rule.autoAssign) await this.assign(c, id, rule.pool, rule.poolRoles);
    if (rule.firstContactHours)
      await c.query(
        `UPDATE admission_enquiries SET contact_due_at = app.helpdesk_add_hours(now(), $2::numeric)
          WHERE id = $1 AND first_contact_at IS NULL`,
        [id, rule.firstContactHours],
      );
    return rule;
  }

  async saveDesk(ctx: RequestContext, dto: EnquiryDeskDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.deskWith(c);
      if (dto.counsellors.length) {
        const ok = await c.query<{ id: string }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
          `SELECT id::text FROM (${COUNSELLORS}) k WHERE id = ANY($1::bigint[])`,
          [dto.counsellors],
        );
        if (ok.rows.length !== new Set(dto.counsellors).size)
          throw new DomainError(
            'validation-failed',
            'A counsellor chosen cannot take enquiries (no enquiry permission)',
            { status: 400 },
          );
      }
      // the "everything else" rule (docs/design/45, part 3)
      await c.query(
        `UPDATE admission_enquiry_rules SET auto_assign = $1, pool = $2::bigint[], acknowledge = $3
          WHERE is_default AND status = 'active'`,
        [dto.autoAssign, [...new Set(dto.counsellors)], dto.acknowledge],
      );
      const after = await this.deskWith(c);
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.desk',
        entityType: 'admission_enquiry_rules',
        entityId: ctx.tenant!.schoolId,
        before,
        after,
      });
      return after;
    });
  }

  /**
   * A website enquiry given to a counsellor on arrival: among those chosen (or everyone who takes
   * enquiries), the one with the fewest open enquiries; ties go to the one given an enquiry longest ago.
   */
  private async assign(
    c: PoolClient,
    id: string,
    chosen: string[],
    roles: string[] = [],
  ): Promise<string | null> {
    // the people named and the holders today of the roles named (docs/design/46, part 2)
    const k = await c.query<{ id: string; name: string }>(
      // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
      `SELECT k.id::text, k.name FROM (${COUNSELLORS}) k
        WHERE (cardinality($1::bigint[]) = 0 AND cardinality($2::text[]) = 0) OR k.id = ANY($1::bigint[])
           OR k.id IN (SELECT p.user_id FROM unnest($2::text[]) AS r(code), LATERAL app.helpdesk_role_people(r.code) p)
        ORDER BY (SELECT count(*) FROM admission_enquiries e WHERE e.counsellor_user_id = k.id AND e.status IN ('new', 'follow_up', 'interested')),
                 (SELECT max(e.assigned_at) FROM admission_enquiries e WHERE e.counsellor_user_id = k.id) ASC NULLS FIRST, k.id
        LIMIT 1`,
      [chosen, roles],
    );
    const who = k.rows[0];
    if (!who) return null;
    await c.query(
      `UPDATE admission_enquiries SET counsellor_user_id = $2, assigned_at = now() WHERE id = $1`,
      [id, who.id],
    );
    await c.query(
      `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome) VALUES (app.current_school_id(), $1, 'system', $2)`,
      [id, `Assigned to ${who.name} on arrival`],
    );
    return who.name;
  }

  /** The school's stages of a lead (docs/design/45, part 1), seeded with the eight on first use. */
  private async stagesWith(c: PoolClient) {
    await c.query(`SELECT app.enquiry_stages_seed(app.current_school_id())`);
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      kind: string;
      status: string;
      leads: number;
    }>(
      `SELECT s.id::text, s.code, s.name, s.kind, s.status,
              (SELECT count(*)::int FROM admission_enquiries e WHERE e.stage_id = s.id) AS leads
         FROM admission_enquiry_stages s ORDER BY s.sort_order, s.id`,
    );
    return r.rows;
  }

  async saveStages(ctx: RequestContext, dto: StagesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.stagesWith(c);
      const live = dto.stages.filter((x) => x.status === 'active');
      for (const kind of ['started', 'registered', 'admitted', 'lost'] as const)
        if (live.filter((x) => x.kind === kind).length !== 1)
          throw new DomainError(
            'validation-failed',
            `Keep exactly one stage for ${kind === 'started' ? 'a registration started' : kind === 'lost' ? 'lost leads' : `the ${kind}`}`,
            { status: 400 },
          );
      if (!live.some((x) => x.kind === 'open'))
        throw new DomainError('validation-failed', 'Keep at least one open stage', { status: 400 });
      for (const [i, x] of dto.stages.entries()) {
        const had = x.id ? before.find((b) => b.id === x.id) : undefined;
        if (x.id && !had) throw new DomainError('not-found', 'Unknown stage', { status: 404 });
        if (had && had.kind !== x.kind)
          throw new DomainError('validation-failed', `${had.name}: its kind cannot change`, {
            status: 400,
          });
        if (had)
          await c.query(
            `UPDATE admission_enquiry_stages SET name = $2, status = $3, sort_order = $4 WHERE id = $1`,
            [x.id, x.name, x.status, i + 1],
          );
        else {
          const base =
            x.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 24) || 'stage';
          const code = /^[a-z]/.test(base) ? base : `s_${base}`;
          await c.query(
            `INSERT INTO admission_enquiry_stages (school_id, code, name, kind, status, sort_order)
             VALUES (app.current_school_id(), $1 || CASE WHEN EXISTS (SELECT 1 FROM admission_enquiry_stages WHERE code = $1) THEN '_' || ($5::int)::text ELSE '' END, $2, $3, $4, $5::int)`,
            [code, x.name, x.kind, x.status, i + 1],
          );
        }
      }
      // a stage left out with leads in it is switched off; an empty one goes
      const keep = dto.stages.filter((x) => x.id).map((x) => x.id!);
      for (const b of before.filter((b) => !keep.includes(b.id))) {
        if (b.leads)
          await c.query(`UPDATE admission_enquiry_stages SET status = 'inactive' WHERE id = $1`, [
            b.id,
          ]);
        else await c.query(`DELETE FROM admission_enquiry_stages WHERE id = $1`, [b.id]);
      }
      const after = await this.stagesWith(c);
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.stages',
        entityType: 'admission_enquiry_stages',
        entityId: ctx.tenant!.schoolId,
        before: before.map((x) => x.name),
        after: after.map((x) => x.name),
      });
      return after;
    });
  }

  /** A lead moved by hand: an open stage, or Lost with its reason; the registration moves the rest. */
  private async moveIn(c: PoolClient, ctx: RequestContext, id: string, dto: MoveDto) {
    const st = await c.query<{ name: string; kind: string; status: string }>(
      `SELECT name, kind, status FROM admission_enquiry_stages WHERE id = $1`,
      [dto.stageId],
    );
    const s = st.rows[0];
    if (!s || s.status !== 'active')
      throw new DomainError('validation-failed', 'Unknown stage', { status: 400 });
    if (s.kind !== 'open' && s.kind !== 'lost')
      throw new DomainError(
        'validation-failed',
        `${s.name} is set by the registration itself (the family starts, registers, is admitted)`,
        { status: 400 },
      );
    if (s.kind === 'lost' && !dto.lostReason)
      throw new DomainError('validation-failed', 'Say why the lead is lost', { status: 400 });
    const e = await this.row(c, id);
    if (e.application_id && s.kind !== 'lost')
      throw new DomainError('admissions.enquiry_converted', 'The family has registered already', {
        status: 409,
      });
    await c.query(
      `UPDATE admission_enquiries SET stage_id = $2, lost_reason = $3, updated_at = now(),
              next_follow_up_on = CASE WHEN $4 THEN NULL ELSE next_follow_up_on END
        WHERE id = $1`,
      [id, dto.stageId, s.kind === 'lost' ? dto.lostReason : null, s.kind === 'lost'],
    );
    await c.query(
      `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
       VALUES (app.current_school_id(), $1, 'note', $2, $3)`,
      [id, `Moved to ${s.name}${s.kind === 'lost' ? ` (${dto.lostReason})` : ''}`, ctx.user.id],
    );
  }

  async move(ctx: RequestContext, id: string, dto: MoveDto) {
    await this.db.tenant(requireTenant(ctx), (c) => this.moveIn(c, ctx, id, dto));
    return this.get(ctx, id);
  }

  /** Many leads at once: given to a counsellor, moved, scored (docs/design/45, part 1). */
  async bulk(ctx: RequestContext, dto: BulkDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...new Set(dto.ids)];
      const found = await c.query<{ id: string }>(
        `SELECT id::text FROM admission_enquiries WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      if (found.rowCount !== ids.length)
        throw new DomainError('not-found', 'An enquiry was not found', { status: 404 });
      if (dto.counsellorUserId !== undefined) {
        if (dto.counsellorUserId) {
          const ok = await c.query(
            // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
            `SELECT 1 FROM (${COUNSELLORS}) k WHERE k.id = $1`,
            [dto.counsellorUserId],
          );
          if (!ok.rowCount)
            throw new DomainError('validation-failed', 'This person does not take enquiries', {
              status: 400,
            });
        }
        await c.query(
          `UPDATE admission_enquiries SET counsellor_user_id = $2, updated_at = now(),
                  assigned_at = CASE WHEN $2::bigint IS DISTINCT FROM counsellor_user_id THEN now() ELSE assigned_at END
            WHERE id = ANY($1::bigint[])`,
          [ids, dto.counsellorUserId],
        );
      }
      if (dto.score)
        await c.query(
          `UPDATE admission_enquiries SET score = $2, updated_at = now() WHERE id = ANY($1::bigint[])`,
          [ids, dto.score === 'none' ? null : dto.score],
        );
      let skipped = 0;
      if (dto.stageId)
        for (const id of ids)
          try {
            await c.query('SAVEPOINT lead');
            await this.moveIn(c, ctx, id, { stageId: dto.stageId, lostReason: dto.lostReason });
            await c.query('RELEASE SAVEPOINT lead');
          } catch (e) {
            await c.query('ROLLBACK TO SAVEPOINT lead');
            if (!(e instanceof DomainError) || ids.length === 1) throw e;
            skipped += 1;
          }
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.bulk',
        entityType: 'admission_enquiries',
        entityId: ids[0]!,
        after: {
          count: ids.length,
          counsellor: dto.counsellorUserId,
          stage: dto.stageId,
          score: dto.score,
        },
      });
      return { done: ids.length - skipped, skipped };
    });
  }

  async saveSources(ctx: RequestContext, dto: SourcesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.sourcesWith(c);
      const kept = new Set(dto.sources.map((s) => s.id).filter(Boolean));
      for (const old of before)
        if (!kept.has(old.id)) {
          if (old.used)
            await c.query(
              `UPDATE admission_enquiry_sources SET status = 'inactive' WHERE id = $1`,
              [old.id],
            );
          else await c.query(`DELETE FROM admission_enquiry_sources WHERE id = $1`, [old.id]);
        }
      for (const [i, s] of dto.sources.entries())
        if (s.id && before.some((b) => b.id === s.id))
          await c.query(
            `UPDATE admission_enquiry_sources SET name = $2, status = $3, sort_order = $4 WHERE id = $1`,
            [s.id, s.name, s.status, i],
          );
        else
          await c.query(
            `INSERT INTO admission_enquiry_sources (school_id, name, status, sort_order) VALUES (app.current_school_id(), $1, $2, $3)`,
            [s.name, s.status, i],
          );
      return this.sourcesWith(c);
    });
  }

  /** The leads of the filters in the list's order, at most 5000 (docs/design/46, part 1). */
  private async exportIds(c: PoolClient, ctx: RequestContext, q: EnquiryExportDto) {
    const { where, params } = this.filterOf(ctx, q);
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- where holds fixed fragments; values are bound parameters
      `SELECT e.id::text FROM admission_enquiries e WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN e.status IN ('new', 'follow_up', 'interested') THEN 0 ELSE 1 END, e.next_follow_up_on NULLS LAST, e.created_at DESC
        LIMIT 5000`,
      params,
    );
    if (!r.rows.length)
      throw new DomainError('validation-failed', 'There are no enquiries for these filters.', {
        status: 400,
      });
    return r.rows.map((x) => x.id);
  }

  /** The words that say which leads a file holds (its title and the PDF's heading). */
  private async exportTitle(c: PoolClient, q: EnquiryExportDto, n: number) {
    const name = async (sql: string, id?: string) =>
      id ? ((await c.query<{ n: string }>(sql, [id])).rows[0]?.n ?? null) : null;
    return [
      'Admission enquiries',
      await name(`SELECT name AS n FROM admission_enquiry_stages WHERE id = $1`, q.stageId),
      await name(`SELECT name AS n FROM classes WHERE id = $1`, q.classId),
      await name(`SELECT name AS n FROM admission_enquiry_sources WHERE id = $1`, q.sourceId),
      q.due
        ? { today: 'follow-up today', overdue: 'overdue', upcoming: 'follow-up later' }[q.due]
        : null,
      q.score ? (q.score === 'none' ? 'not scored' : q.score) : null,
      q.counsellor === 'me' ? 'mine' : q.counsellor === 'none' ? 'nobody yet' : null,
      q.q ? `"${q.q}"` : null,
      `${String(n)} enquiries`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** The leads of the filters as Excel, at once. */
  async listXlsx(ctx: RequestContext, q: EnquiryExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = await this.exportIds(c, ctx, q);
      const title = await this.exportTitle(c, q, ids.length);
      const r = await c.query<Record<string, unknown>>(
        `SELECT 'ENQ-' || lpad(e.id::text, 6, '0') AS number, e.created_at, e.parent_name, e.child_name, cl.name AS class_name,
                src.name AS source, st.name AS stage, initcap(e.score) AS score, u.display_name AS counsellor, e.mobile,
                e.email::text AS email, e.next_follow_up_on::text AS next_follow_up_on, e.first_contact_at, a.application_no AS registration_no,
                e.locality, e.notes
           FROM admission_enquiries e
           LEFT JOIN classes cl ON cl.id = e.class_id LEFT JOIN admission_enquiry_sources src ON src.id = e.source_id
           LEFT JOIN admission_enquiry_stages st ON st.id = e.stage_id LEFT JOIN users u ON u.id = e.counsellor_user_id
           LEFT JOIN applications a ON a.id = e.application_id
          WHERE e.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], e.id)`,
        [ids],
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Enquiries');
      ws.addRow([title]).font = { bold: true };
      ws.addRow([]);
      const cols: Array<[string, string, number]> = [
        ['number', 'Enquiry', 12],
        ['created_at', 'Received', 12],
        ['parent_name', 'Parent', 24],
        ['child_name', 'Child', 22],
        ['class_name', 'Class', 12],
        ['source', 'Source', 16],
        ['stage', 'Stage', 18],
        ['score', 'Score', 8],
        ['counsellor', 'Counsellor', 20],
        ['mobile', 'Mobile', 13],
        ['email', 'Email', 28],
        ['next_follow_up_on', 'Next follow-up', 14],
        ['first_contact_at', 'First contact', 18],
        ['registration_no', 'Registration no.', 20],
        ['locality', 'Locality', 18],
        ['notes', 'Notes', 40],
      ];
      ws.addRow(cols.map((x) => x[1])).font = { bold: true };
      cols.forEach(([, , w], i) => (ws.getColumn(i + 1).width = w));
      const ist = (d: unknown, withTime: boolean) =>
        d instanceof Date
          ? new Intl.DateTimeFormat('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
            }).format(d)
          : d;
      for (const row of r.rows)
        ws.addRow(
          cols.map(([k]) =>
            k === 'created_at'
              ? ist(row[k], false)
              : k === 'first_contact_at'
                ? ist(row[k], true)
                : (row[k] ?? ''),
          ),
        );
      ws.views = [{ state: 'frozen', ySplit: 3 }];
      return {
        bytes: Buffer.from(await wb.xlsx.writeBuffer()),
        filename: `enquiries-${new Date().toISOString().slice(0, 10)}.xlsx`,
      };
    });
  }

  /** The leads of the filters as a PDF through the export queue; returns the export id. */
  async listPdf(ctx: RequestContext, q: EnquiryExportDto): Promise<{ id: string }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = await this.exportIds(c, ctx, q);
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), 'admission_enquiries', 'pdf', $1::jsonb, $2, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [JSON.stringify({ ids }), await this.exportTitle(c, q, ids.length)],
      );
      const id = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId: id });
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.list_export',
        entityType: 'exports',
        entityId: id,
        after: { format: 'pdf', enquiries: ids.length },
      });
      return { id };
    });
  }

  /** The list's filters as SQL (the list, its Excel and its PDF choose the same leads). */
  private filterOf(ctx: RequestContext, q: Partial<EnquiryQueryDto>) {
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.status === 'open') where.push(`e.status IN ('new', 'follow_up', 'interested')`);
    else if (q.status) add('e.status = ?', q.status);
    if (q.sourceId) add('e.source_id = ?', q.sourceId);
    if (q.classId) add('e.class_id = ?', q.classId);
    if (q.cycleId) add('e.cycle_id = ?', q.cycleId);
    if (q.counsellor === 'me') add('e.counsellor_user_id = ?', ctx.user.id);
    else if (q.counsellor === 'none') where.push('e.counsellor_user_id IS NULL');
    else if (q.counsellor) add('e.counsellor_user_id = ?', q.counsellor);
    if (q.due === 'today')
      add(
        `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on = ?::date`,
        today(),
      );
    if (q.due === 'overdue')
      add(
        `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on < ?::date`,
        today(),
      );
    if (q.due === 'upcoming')
      add(
        `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on > ?::date`,
        today(),
      );
    if (q.stageId) add('e.stage_id = ?', q.stageId);
    if (q.score === 'none') where.push('e.score IS NULL');
    else if (q.score) add('e.score = ?', q.score);
    if (q.q)
      add(
        `(e.parent_name ILIKE ? OR e.child_name ILIKE ? OR e.mobile ILIKE ? OR e.email::text ILIKE ?)`,
        `%${q.q}%`,
      );
    return { where, params };
  }

  async list(ctx: RequestContext, q: EnquiryQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, params } = this.filterOf(ctx, q);
      const w = where.join(' AND ');
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n FROM admission_enquiries e WHERE ${w}`,
        params,
      );
      const counts = await c.query<{
        open: number;
        fresh: number;
        due_today: number;
        overdue: number;
        converted_month: number;
        mine: number;
      }>(
        `SELECT count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested'))::int AS open,
                count(*) FILTER (WHERE status = 'new')::int AS fresh,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND next_follow_up_on = $1::date)::int AS due_today,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND next_follow_up_on < $1::date)::int AS overdue,
                count(*) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now()))::int AS converted_month,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND counsellor_user_id = $2)::int AS mine
           FROM admission_enquiries`,
        [today(), ctx.user.id],
      );
      // the same filters without the stage: how many leads each stage holds
      const sp: unknown[] = [];
      const sw = where
        .filter((x) => !x.startsWith('e.stage_id = '))
        .map((x) =>
          x.replace(/\$(\d+)/g, (_, n: string) => {
            sp.push(params[Number(n) - 1]);
            return `$${String(sp.length)}`;
          }),
        )
        .join(' AND ');
      const byStage = await c.query<{ stageId: string; leads: number }>(
        // eslint-disable-next-line no-restricted-syntax -- sw holds fixed fragments; values are bound parameters
        `SELECT e.stage_id::text AS "stageId", count(*)::int AS leads FROM admission_enquiries e WHERE ${sw} GROUP BY e.stage_id`,
        sp,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<{
        id: string;
        parent_name: string;
        child_name: string | null;
        class_name: string | null;
        source: string | null;
        campaign: string | null;
        mobile: string | null;
        email: string | null;
        status: string;
        next_follow_up_on: string | null;
        counsellor: string | null;
        created_at: Date;
        last_contact_at: Date | null;
        from_website: boolean;
        application_no: string | null;
        stage_id: string | null;
        stage: string | null;
        stage_kind: string | null;
        score: string | null;
        first_contact_at: Date | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments; values are bound parameters
        `SELECT e.id::text, e.parent_name, e.child_name, cl.name AS class_name, s.name AS source, e.campaign, e.mobile, e.email::text,
                e.status, e.next_follow_up_on::text, u.display_name AS counsellor, e.created_at, e.last_contact_at, e.from_website,
                a.application_no, e.stage_id::text, st.name AS stage, st.kind AS stage_kind, e.score, e.first_contact_at
           FROM admission_enquiries e LEFT JOIN classes cl ON cl.id = e.class_id LEFT JOIN admission_enquiry_sources s ON s.id = e.source_id
           LEFT JOIN users u ON u.id = e.counsellor_user_id LEFT JOIN applications a ON a.id = e.application_id
           LEFT JOIN admission_enquiry_stages st ON st.id = e.stage_id
          WHERE ${w}
          ORDER BY CASE WHEN e.status IN ('new', 'follow_up', 'interested') THEN 0 ELSE 1 END, e.next_follow_up_on NULLS LAST, e.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const k = counts.rows[0]!;
      return {
        total: total.rows[0]?.n ?? 0,
        counts: {
          open: k.open,
          new: k.fresh,
          dueToday: k.due_today,
          overdue: k.overdue,
          convertedThisMonth: k.converted_month,
          mine: k.mine,
        },
        data: r.rows.map((x) => ({
          id: x.id,
          parentName: x.parent_name,
          childName: x.child_name,
          className: x.class_name,
          source: x.source,
          campaign: x.campaign,
          mobile: x.mobile,
          email: x.email,
          status: x.status,
          nextFollowUpOn: x.next_follow_up_on,
          counsellor: x.counsellor,
          createdAt: x.created_at.toISOString(),
          lastContactAt: x.last_contact_at?.toISOString() ?? null,
          fromWebsite: x.from_website,
          registrationNo: x.application_no,
          stage: x.stage_id ? { id: x.stage_id, name: x.stage!, kind: x.stage_kind! } : null,
          score: x.score,
          firstContactAt: x.first_contact_at?.toISOString() ?? null,
        })),
        // the leads of each stage under the same filters but the stage (the board's columns)
        byStage: byStage.rows,
      };
    });
  }

  private async row(c: PoolClient, id: string) {
    const r = await c.query<{
      id: string;
      cycle_id: string | null;
      class_id: string | null;
      source_id: string | null;
      campaign: string | null;
      parent_name: string;
      child_name: string | null;
      child_dob: string | null;
      mobile: string | null;
      email: string | null;
      locality: string | null;
      previous_school: string | null;
      notes: string | null;
      status: string;
      counsellor_user_id: string | null;
      next_follow_up_on: string | null;
      invited_at: Date | null;
      application_id: string | null;
      converted_at: Date | null;
      from_website: boolean;
      created_at: Date;
      created_by: string | null;
      stage_id: string | null;
      score: string | null;
      lost_reason: string | null;
      first_contact_at: Date | null;
      level: number;
      contact_due_at: Date | null;
      escalated_at: Date | null;
      rule_name: string | null;
    }>(
      `SELECT e.level, e.contact_due_at, e.escalated_at, (SELECT name FROM admission_enquiry_rules WHERE id = e.rule_id) AS rule_name,
              e.stage_id::text, e.score, e.lost_reason, e.first_contact_at, e.id::text, e.cycle_id::text, e.class_id::text, e.source_id::text, e.campaign, e.parent_name, e.child_name, e.child_dob::text,
              e.mobile, e.email::text, e.locality, e.previous_school, e.notes, e.status, e.counsellor_user_id::text, e.next_follow_up_on::text,
              e.invited_at, e.application_id::text, e.converted_at, e.from_website, e.created_at, u.display_name AS created_by
         FROM admission_enquiries e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Enquiry not found', { status: 404 });
    return r.rows[0];
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      const followups = await c.query<{
        id: string;
        mode: string;
        outcome: string;
        next_on: string | null;
        status_after: string | null;
        by: string | null;
        at: Date;
      }>(
        `SELECT f.id::text, f.mode, f.outcome, f.next_on::text, f.status_after, u.display_name AS by, f.at
           FROM admission_enquiry_followups f LEFT JOIN users u ON u.id = f.by_user_id WHERE f.enquiry_id = $1 ORDER BY f.at DESC, f.id DESC`,
        [id],
      );
      const app = e.application_id
        ? (
            await c.query<{ number: string | null; status: string; candidate: string | null }>(
              `SELECT application_no AS number, status::text, candidate_name AS candidate FROM applications WHERE id = $1`,
              [e.application_id],
            )
          ).rows[0]
        : null;
      return {
        id: e.id,
        number: enquiryNo(e.id),
        cycleId: e.cycle_id,
        classId: e.class_id,
        sourceId: e.source_id,
        campaign: e.campaign,
        parentName: e.parent_name,
        childName: e.child_name,
        childDob: e.child_dob,
        mobile: e.mobile,
        email: e.email,
        locality: e.locality,
        previousSchool: e.previous_school,
        notes: e.notes,
        status: e.status,
        counsellorUserId: e.counsellor_user_id,
        nextFollowUpOn: e.next_follow_up_on,
        invitedAt: e.invited_at?.toISOString() ?? null,
        fromWebsite: e.from_website,
        createdAt: e.created_at.toISOString(),
        createdBy: e.created_by,
        application: e.application_id && app ? { id: e.application_id, ...app } : null,
        stageId: e.stage_id,
        score: e.score,
        lostReason: e.lost_reason,
        firstContactAt: e.first_contact_at?.toISOString() ?? null,
        rule: e.rule_name,
        level: e.level,
        contactDueAt: e.contact_due_at?.toISOString() ?? null,
        escalatedAt: e.escalated_at?.toISOString() ?? null,
        stages: await this.stagesWith(c),
        convertedAt: e.converted_at?.toISOString() ?? null,
        followups: followups.rows.map((f) => ({
          id: f.id,
          mode: f.mode,
          outcome: f.outcome,
          nextOn: f.next_on,
          statusAfter: f.status_after,
          by: f.by,
          at: f.at.toISOString(),
        })),
      };
    });
  }

  private values(dto: EnquiryDto) {
    return [
      dto.cycleId ?? null,
      dto.classId ?? null,
      dto.sourceId ?? null,
      dto.campaign ?? null,
      dto.parentName,
      dto.childName ?? null,
      dto.childDob ?? null,
      dto.mobile ?? null,
      dto.email?.toLowerCase() ?? null,
      dto.locality ?? null,
      dto.previousSchool ?? null,
      dto.notes ?? null,
      dto.counsellorUserId ?? null,
      dto.nextFollowUpOn ?? null,
    ];
  }

  async create(ctx: RequestContext, dto: EnquiryDto) {
    const id = await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sourcesWith(c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, campaign, parent_name, child_name, child_dob, mobile, email,
                                          locality, previous_school, notes, counsellor_user_id, next_follow_up_on, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, $15::bigint), COALESCE($14::date, CURRENT_DATE), $15)
         RETURNING id::text`,
        [...this.values(dto), ctx.user.id],
      );
      // taken at the desk: the person there has it; the rule is noted for the reports
      await this.arrive(c, r.rows[0]!.id, dto.classId ?? null, dto.sourceId ?? null, false);
      await c.query(
        `UPDATE admission_enquiries SET contact_due_at = NULL WHERE id = $1 AND counsellor_user_id IS NOT NULL`,
        [r.rows[0]!.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.create',
        entityType: 'admission_enquiries',
        entityId: r.rows[0]!.id,
        after: { source: dto.sourceId ?? null, classId: dto.classId ?? null },
      });
      return r.rows[0]!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: EnquiryUpdateDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c, id);
      if (dto.status === 'converted' && !before.application_id)
        throw new DomainError(
          'validation-failed',
          'An enquiry becomes converted when the family registers',
          { status: 400 },
        );
      await c.query(
        `UPDATE admission_enquiries SET cycle_id = $1, class_id = $2, source_id = $3, campaign = $4, parent_name = $5, child_name = $6, child_dob = $7,
                mobile = $8, email = $9, locality = $10, previous_school = $11, notes = $12, counsellor_user_id = $13, next_follow_up_on = $14,
                status = COALESCE($16, status), updated_at = now(),
                assigned_at = CASE WHEN $13::bigint IS DISTINCT FROM counsellor_user_id THEN now() ELSE assigned_at END
          WHERE id = $15`,
        [...this.values(dto), id, dto.status ?? null],
      );
      if (dto.counsellorUserId && dto.counsellorUserId !== before.counsellor_user_id)
        await c.query(
          `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
           SELECT app.current_school_id(), $1, 'note', 'Counsellor: ' || u.display_name, $3 FROM users u WHERE u.id = $2`,
          [id, dto.counsellorUserId, ctx.user.id],
        );
    });
    return this.get(ctx, id);
  }

  /** A call, a visit, a message or a note: the outcome, the next date and the status after it. */
  async followUp(ctx: RequestContext, id: string, dto: FollowUpDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      if (['converted', 'closed'].includes(e.status) && dto.status !== 'follow_up')
        throw new DomainError(
          'admissions.enquiry_closed',
          'This enquiry is closed; reopen it with a follow-up status',
          { status: 409 },
        );
      const next =
        dto.status === 'not_interested' || dto.status === 'closed' ? null : (dto.nextOn ?? null);
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, next_on, status_after, by_user_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [id, dto.mode, dto.outcome, next, dto.status ?? null, ctx.user.id],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = COALESCE($2, CASE WHEN status = 'new' THEN 'follow_up' ELSE status END), next_follow_up_on = $3,
                last_contact_at = now(), counsellor_user_id = COALESCE(counsellor_user_id, $4), updated_at = now() WHERE id = $1`,
        [id, dto.status ?? null, next, ctx.user.id],
      );
    });
    return this.get(ctx, id);
  }

  /**
   * A reply to the family (docs/design/43, part 3): the message by email and / or SMS (and WhatsApp
   * where the school sends it), kept with the follow-ups; the enquiry counts as contacted.
   */
  async reply(ctx: RequestContext, id: string, dto: ReplyDto) {
    const sent = await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      const email = dto.email ? e.email : null;
      const mobile = dto.mobile ? e.mobile : null;
      if (!email && !mobile)
        throw new DomainError(
          'validation-failed',
          dto.email && !dto.mobile
            ? 'The enquiry has no email'
            : !dto.email && dto.mobile
              ? 'The enquiry has no mobile'
              : 'The enquiry has no email or mobile',
          { status: 400 },
        );
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const n = await c.query<{ n: number }>(
        `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8) AS n`,
        [
          'admission_message',
          mobile,
          email,
          JSON.stringify({
            ...messageTag('enquiry_reply', { applicationId: e.application_id }),
            subject: `Your enquiry ${enquiryNo(id)} at ${school.rows[0]!.name}`,
            message: dto.message,
            name: e.child_name ?? '',
          }),
          'About your enquiry',
          dto.message,
          JSON.stringify([['Enquiry no.', enquiryNo(id)]]),
          'Reply to this by calling the school office, or send a new enquiry from the admission page.',
        ],
      );
      const count = n.rows[0]?.n ?? 0;
      if (!count)
        throw new DomainError(
          'admissions.reply_not_sent',
          'Nothing could be sent: check the address and the admission message templates',
          { status: 409 },
        );
      const by = [email ? 'email' : '', mobile ? 'SMS' : ''].filter(Boolean).join(' and ');
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
         VALUES (app.current_school_id(), $1, 'reply', $2, $3)`,
        [id, `Reply by ${by}: ${dto.message}`, ctx.user.id],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = CASE WHEN status = 'new' THEN 'follow_up' ELSE status END, last_contact_at = now(),
                counsellor_user_id = COALESCE(counsellor_user_id, $2),
                assigned_at = CASE WHEN counsellor_user_id IS NULL THEN now() ELSE assigned_at END, updated_at = now()
          WHERE id = $1`,
        [id, ctx.user.id],
      );
      return count;
    });
    return { sent, enquiry: await this.get(ctx, id) };
  }

  /**
   * A walk-in sent the form link (docs/design/45, part 4): the visit is an enquiry of the person at the
   * desk (source Walk-in, the visit its first contact), and the invitation goes to the parent's phone /
   * email; the form starts with the child's name and date of birth.
   */
  async deskLink(ctx: RequestContext, dto: DeskLinkDto) {
    const id = await this.db.tenant(requireTenant(ctx), async (c) => {
      const sources = await this.sourcesWith(c);
      const walkIn = sources.find((x) => x.name.toLowerCase() === 'walk-in');
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, parent_name, child_name, child_dob, mobile, email,
                                          counsellor_user_id, assigned_at, next_follow_up_on, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), CURRENT_DATE + 2, $9)
         RETURNING id::text`,
        [
          dto.cycleId,
          dto.classId,
          walkIn?.id ?? null,
          dto.parentName,
          dto.childName ?? null,
          dto.childDob ?? null,
          dto.mobile ?? null,
          dto.email?.toLowerCase() ?? null,
          ctx.user.id,
        ],
      );
      const id = r.rows[0]!.id;
      await this.arrive(c, id, dto.classId, walkIn?.id ?? null, false);
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
         VALUES (app.current_school_id(), $1, 'visit', 'Came to the admission desk', $2)`,
        [id, ctx.user.id],
      );
      return id;
    });
    const out = await this.invite(ctx, id, { cycleId: dto.cycleId });
    return { enquiryId: id, sent: out.sent, link: out.link };
  }

  /** The invitation to register: a link that fills the form from the enquiry, by email, SMS and WhatsApp. */
  async invite(ctx: RequestContext, id: string, dto: InviteDto) {
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      if (e.application_id)
        throw new DomainError('admissions.enquiry_converted', 'The family has registered already', {
          status: 409,
        });
      const cycleId = dto.cycleId ?? e.cycle_id;
      const cyc = await c.query<{
        code: string;
        name: string;
        school: string;
        school_code: string;
      }>(
        `SELECT y.code, y.name, s.name AS school, lower(s.code) AS school_code FROM admission_cycles y JOIN schools s ON s.id = y.school_id
          WHERE ($1::bigint IS NULL OR y.id = $1::bigint) AND y.status = 'open' AND y.deleted_at IS NULL ORDER BY y.opens_at DESC LIMIT 1`,
        [cycleId],
      );
      if (!cyc.rows[0])
        throw new DomainError(
          'admissions.no_open_session',
          'No admission session is open to register in',
          { status: 409 },
        );
      const token = randomBytes(24).toString('base64url');
      const link = `${this.env.PUBLIC_APP_URL}/${cyc.rows[0].school_code}/admission?session=${encodeURIComponent(cyc.rows[0].code)}&enquiry=${token}`;
      await c.query(
        `UPDATE admission_enquiries SET invite_token_hash = $2, invited_at = now(), updated_at = now() WHERE id = $1`,
        [id, enquiryTokenHash(token)],
      );
      const message =
        dto.message?.trim() ||
        `Dear ${e.parent_name}, thank you for your interest in ${cyc.rows[0].school}. Registrations for ${cyc.rows[0].name} are open: register ${e.child_name ?? 'your ward'} online at ${link}`;
      const n = await c.query<{ n: number }>(
        `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8) AS n`,
        [
          'admission_message',
          e.mobile,
          e.email,
          JSON.stringify({
            ...messageTag('enquiry_invite'),
            subject: `Register for admission at ${cyc.rows[0].school}`,
            message,
            name: e.child_name ?? '',
          }),
          'Registrations are open',
          message,
          JSON.stringify([
            ['Session', cyc.rows[0].name],
            ['Register at', link],
          ]),
          'Sign in with your mobile number or email; the form starts with the details you gave us.',
        ],
      );
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id) VALUES (app.current_school_id(), $1, 'invite', $2, $3)`,
        [
          id,
          `Invited to register (${n.rows[0]?.n ?? 0} message${(n.rows[0]?.n ?? 0) === 1 ? '' : 's'} sent)`,
          ctx.user.id,
        ],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = CASE WHEN status = 'new' THEN 'follow_up' ELSE status END, last_contact_at = now() WHERE id = $1`,
        [id],
      );
      return { link, sent: n.rows[0]?.n ?? 0 };
    });
    return { ...out, enquiry: await this.get(ctx, id) };
  }

  /** The enquiry form of the school's website. */
  async publicCreate(schoolId: string, dto: PublicEnquiryDto) {
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const sources = await this.sourcesWith(c);
      const web = sources.find((s) => s.name.toLowerCase() === 'website');
      if (dto.classId) {
        const ok = await c.query(`SELECT 1 FROM classes WHERE id = $1 AND deleted_at IS NULL`, [
          dto.classId,
        ]);
        if (!ok.rows.length)
          throw new DomainError('validation-failed', 'Unknown class', { status: 400 });
      }
      const open = await c.query<{ id: string }>(
        `SELECT id::text FROM admission_cycles WHERE status = 'open' AND deleted_at IS NULL ORDER BY opens_at DESC LIMIT 1`,
      );
      const made = await c.query<{ id: string }>(
        `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, parent_name, child_name, child_dob, mobile, email, locality, notes,
                                          next_follow_up_on, from_website)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, true)
         RETURNING id::text`,
        [
          open.rows[0]?.id ?? null,
          dto.classId ?? null,
          web?.id ?? null,
          dto.parentName,
          dto.childName ?? null,
          dto.childDob ?? null,
          dto.mobile ?? null,
          dto.email?.toLowerCase() ?? null,
          dto.locality ?? null,
          dto.message ?? null,
        ],
      );
      const id = made.rows[0]!.id;
      const desk = await this.deskWith(c);
      const rule = await this.arrive(c, id, dto.classId ?? null, web?.id ?? null, true);
      // the family's acknowledgement with its number, by the channels the school signs families in with
      let acknowledged = 0;
      if (rule.acknowledge) {
        const school = await c.query<{ name: string; phone: string | null }>(
          `SELECT name, NULLIF(btrim(contact->>'phone'), '') AS phone FROM schools WHERE id = app.current_school_id()`,
        );
        const s = school.rows[0]!;
        const message = `Dear ${dto.parentName}, we have your admission enquiry ${enquiryNo(id)} at ${s.name}. The admission office will get back to you soon.`;
        const n = await c.query<{ n: number }>(
          `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9) AS n`,
          [
            'admission_message',
            desk.channels.some((x) => x === 'sms' || x === 'whatsapp')
              ? (dto.mobile ?? null)
              : null,
            desk.channels.includes('email') ? (dto.email?.toLowerCase() ?? null) : null,
            JSON.stringify({
              ...messageTag('enquiry_ack'),
              subject: `We have your enquiry ${enquiryNo(id)}`,
              message,
              name: dto.childName ?? '',
            }),
            'We have your enquiry',
            message,
            enquiryNo(id),
            JSON.stringify([
              ['Enquiry no.', enquiryNo(id)],
              ...(dto.childName ? [['Child', dto.childName]] : []),
            ]),
            s.phone ? `Quote the enquiry number when you call the school at ${s.phone}.` : null,
          ],
        );
        acknowledged = n.rows[0]?.n ?? 0;
        if (acknowledged)
          await c.query(
            `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome) VALUES (app.current_school_id(), $1, 'system', $2)`,
            [
              id,
              `Acknowledgement sent (${String(acknowledged)} message${acknowledged === 1 ? '' : 's'})`,
            ],
          );
      }
      return { received: true, enquiryNo: enquiryNo(id) };
    });
  }

  private static readonly IMPORT_HEADERS = [
    'Parent name',
    'Child name',
    'Child date of birth',
    'Mobile',
    'Email',
    'Class',
    'Source',
    'Locality',
    'Notes',
  ];

  /** The Excel format of enquiries to add, with the school's classes and sources as drop-downs. */
  async importFormat(ctx: RequestContext) {
    const l = await this.db.tenant(requireTenant(ctx), async (c) => ({
      classes: (
        await c.query<{ name: string }>(
          `SELECT name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
        )
      ).rows.map((x) => x.name),
      sources: (await this.sourcesWith(c)).filter((x) => x.status === 'active').map((x) => x.name),
    }));
    return {
      bytes: await templateSheet({
        sheet: 'Enquiries',
        columns: [
          { header: 'Parent name', width: 26, required: true },
          { header: 'Child name', width: 24 },
          { header: 'Child date of birth', width: 16, format: 'date', note: 'dd-mm-yyyy' },
          {
            header: 'Mobile',
            width: 14,
            format: 'text',
            note: '10 digits; the mobile or the email',
          },
          { header: 'Email', width: 28 },
          { header: 'Class', width: 16, options: l.classes },
          { header: 'Source', width: 18, options: l.sources },
          { header: 'Locality', width: 20 },
          { header: 'Notes', width: 40 },
        ],
        guide: [
          "One row a family. The parent's name and the mobile or the email are needed.",
          'A family already among the enquiries of the last year (the same mobile or email) is not added again: the upload lists it as a duplicate.',
          "Each enquiry added is given to a counsellor as the enquiry desk's rules say.",
          'If a row is wrong nothing is added: correct the rows listed and upload the sheet again.',
        ],
        examples: [
          [
            'Rakesh Sharma',
            'Anaya Sharma',
            '14-07-2021',
            '9810000001',
            '',
            'Class I',
            'Newspaper',
            'Sector 15',
            'Wants the bus',
          ],
        ],
      }),
      filename: 'enquiries-format.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Enquiries from an Excel sheet (docs/design/45, part 2): every row checked first (nothing is added
   * when one is wrong); a family already among the last year's enquiries, or twice in the sheet, is a
   * duplicate and left out; the rest are added and assigned as the desk's rules say.
   */
  async importSheet(ctx: RequestContext, fileBase64: string) {
    const rows = await readSheet(fileBase64, AdmissionEnquiryService.IMPORT_HEADERS);
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no filled row', { status: 400 });
    if (rows.length > 2000)
      throw new DomainError('validation-failed', 'Up to 2000 rows at a time', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, lower(name) AS name FROM classes WHERE deleted_at IS NULL`,
      );
      const sources = await this.sourcesWith(c);
      const errors: Array<{ row: number; message: string }> = [];
      const duplicates: Array<{ row: number; message: string }> = [];
      const seen = new Set<string>();
      const ready: Array<{
        row: number;
        parent: string;
        child: string | null;
        dob: string | null;
        mobile: string | null;
        email: string | null;
        classId: string | null;
        sourceId: string | null;
        locality: string | null;
        notes: string | null;
      }> = [];
      for (const { row, cells } of rows) {
        const v = (k: string) => (cells[k] ?? '').trim();
        const parent = v('Parent name');
        const mobile = v('Mobile').replace(/\D/g, '').slice(-10) || null;
        const email = v('Email').toLowerCase() || null;
        const problem = (m: string) => errors.push({ row, message: m });
        if (parent.length < 2) {
          problem("the parent's name is missing");
          continue;
        }
        if (!mobile && !email) {
          problem('give the mobile or the email');
          continue;
        }
        if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
          problem(`${v('Mobile')} is not a 10-digit mobile number`);
          continue;
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          problem(`${email} is not an email address`);
          continue;
        }
        const dobText = v('Child date of birth');
        let dob: string | null = null;
        if (dobText) {
          const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(dobText);
          dob = /^\d{4}-\d{2}-\d{2}$/.test(dobText)
            ? dobText
            : m
              ? `${m[3]!}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
              : null;
          if (!dob) {
            problem(`${dobText} is not a date (dd-mm-yyyy)`);
            continue;
          }
        }
        const cls = v('Class')
          ? classes.rows.find((x) => x.name === v('Class').toLowerCase())
          : null;
        if (v('Class') && !cls) {
          problem(`no class "${v('Class')}"`);
          continue;
        }
        const src = v('Source')
          ? sources.find((x) => x.name.toLowerCase() === v('Source').toLowerCase())
          : null;
        if (v('Source') && !src) {
          problem(`no source "${v('Source')}" (add it in Admission set-up)`);
          continue;
        }
        const key = mobile ?? email!;
        if (seen.has(key)) {
          duplicates.push({ row, message: `${key} is twice in the sheet` });
          continue;
        }
        seen.add(key);
        ready.push({
          row,
          parent,
          child: v('Child name') || null,
          dob,
          mobile,
          email,
          classId: cls?.id ?? null,
          sourceId: src?.id ?? null,
          locality: v('Locality') || null,
          notes: v('Notes') || null,
        });
      }
      if (errors.length) return { added: 0, duplicates, errors };
      // already an enquiry (the last year), by mobile or email
      const known = await c.query<{ mobile: string | null; email: string | null }>(
        `SELECT mobile, lower(email::text) AS email FROM admission_enquiries
          WHERE created_at > now() - interval '365 days'
            AND (mobile = ANY($1::text[]) OR lower(email::text) = ANY($2::text[]))`,
        [ready.map((x) => x.mobile).filter(Boolean), ready.map((x) => x.email).filter(Boolean)],
      );
      const hasMobile = new Set(known.rows.map((x) => x.mobile).filter(Boolean));
      const hasEmail = new Set(known.rows.map((x) => x.email).filter(Boolean));
      const open = await c.query<{ id: string }>(
        `SELECT id::text FROM admission_cycles WHERE status = 'open' AND deleted_at IS NULL ORDER BY opens_at DESC LIMIT 1`,
      );
      let added = 0;
      for (const x of ready) {
        if ((x.mobile && hasMobile.has(x.mobile)) || (x.email && hasEmail.has(x.email))) {
          duplicates.push({ row: x.row, message: `${x.mobile ?? x.email!} is already an enquiry` });
          continue;
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, parent_name, child_name, child_dob, mobile, email, locality, notes,
                                            next_follow_up_on, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, $11)
           RETURNING id::text`,
          [
            open.rows[0]?.id ?? null,
            x.classId,
            x.sourceId,
            x.parent,
            x.child,
            x.dob,
            x.mobile,
            x.email,
            x.locality,
            x.notes,
            ctx.user.id,
          ],
        );
        await this.arrive(c, r.rows[0]!.id, x.classId, x.sourceId, true);
        added += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.import',
        entityType: 'admission_enquiries',
        entityId: ctx.tenant!.schoolId,
        after: { added, duplicates: duplicates.length },
      });
      duplicates.sort((a, b) => a.row - b.row);
      return { added, duplicates, errors: [] as Array<{ row: number; message: string }> };
    });
  }

  /** Enquiry → registration → admission, by source and by class (a session and / or dates). */
  async report(ctx: RequestContext, q: EnquiryReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params = [q.cycleId ?? null, q.from ?? null, q.to ?? null];
      const base = `FROM admission_enquiries e LEFT JOIN applications a ON a.id = e.application_id
        WHERE ($1::bigint IS NULL OR e.cycle_id = $1::bigint OR a.cycle_id = $1::bigint)
          AND ($2::date IS NULL OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
          AND ($3::date IS NULL OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)`;
      const cols = `count(*)::int AS enquiries,
        count(*) FILTER (WHERE e.status IN ('new', 'follow_up', 'interested'))::int AS open,
        count(*) FILTER (WHERE a.application_no IS NOT NULL)::int AS registered,
        count(*) FILTER (WHERE a.status::text IN ('fee_paid', 'admitted'))::int AS admitted,
        count(*) FILTER (WHERE e.status IN ('not_interested', 'closed'))::int AS lost`;
      const bySource = await c.query<{
        name: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT COALESCE(s.name, 'Not given') AS name, ${cols} ${base.replace('LEFT JOIN applications a', 'LEFT JOIN admission_enquiry_sources s ON s.id = e.source_id LEFT JOIN applications a')}
          GROUP BY 1 ORDER BY 2 DESC`,
        params,
      );
      const byClass = await c.query<{
        name: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT COALESCE(cl.name, 'Not given') AS name, ${cols} ${base.replace('LEFT JOIN applications a', 'LEFT JOIN classes cl ON cl.id = e.class_id LEFT JOIN applications a')}
          GROUP BY 1, cl.display_order ORDER BY cl.display_order NULLS LAST, 1`,
        params,
      );
      const total = await c.query<{
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT ${cols} ${base}`,
        params,
      );
      // registrations of the session that came with no enquiry: the other side of the funnel
      const direct = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM applications a WHERE a.application_no IS NOT NULL AND a.enquiry_id IS NULL AND ($1::bigint IS NULL OR a.cycle_id = $1::bigint)`,
        [q.cycleId ?? null],
      );
      const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0);
      const shape = (r: {
        name?: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }) => ({
        ...r,
        toRegistration: pct(r.registered, r.enquiries),
        toAdmission: pct(r.admitted, r.enquiries),
      });
      return {
        total: shape(total.rows[0]!),
        bySource: bySource.rows.map(shape),
        byClass: byClass.rows.map(shape),
        registeredWithoutEnquiry: direct.rows[0]?.n ?? 0,
      };
    });
  }
}
