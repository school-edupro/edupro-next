import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { employeesByRule, studentsByRule } from '../comms/audience';
import { PushService } from '../comms/push.service';
import { RequestsService } from '../comms/requests.service';
import type { CreateRequestDto } from '../comms/comms.dto';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import {
  ENTITY,
  flowCode,
  needsApproval,
  raiseFee,
  refeeAllowed,
  syncFlows,
  syncLine,
} from './consent-flow';
import {
  answerText,
  checkAnswers,
  checkFields,
  feeOf,
  LAYOUT,
  sourceOptions,
  type Answers,
  type Field,
} from './consent-fields';
import {
  CONSENT,
  type ConsentAudience,
  type ConsentFileQueryDto,
  type ConsentFormDto,
  type ConsentListQueryDto,
  type ConsentRegisterQueryDto,
  type ConsentRespondDto,
  type ConsentSettings,
  type ConsentStatusDto,
  type ConsentDecideDto,
  type ConsentEditDto,
  type ConsentNotifyDto,
  type ConsentSharesDto,
} from './consent-forms.dto';
import { emitConsentEvent } from './consent-events';
import { consentPdf } from './consent-pdf';
import { qrPng } from './visitor-card';
import { WAITING_WITH } from '../fees/fee-approval';

type Row = Record<string, unknown>;
type Status = 'draft' | 'published' | 'closed' | 'archived';

export interface FormDb {
  id: string;
  code: string;
  title: string;
  description: string | null;
  respondents: 'family' | 'staff' | 'both';
  fields: Field[];
  audience: ConsentAudience;
  settings: ConsentSettings;
  status: Status;
  year_id: string;
  published_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  created_by: string | null;
  responses: number;
  misc_fee_id: string | null;
  public_token: string | null;
}

/** Access to one form: managers (the permission), or a share as editor or viewer. */
type Access = 'manage' | 'editor' | 'viewer';
const RANK: Record<Access, number> = { viewer: 1, editor: 2, manage: 3 };
/** A share row reaches the user by name or by a role they hold today; the placeholder binds the user id. */
const SHARED_TO = (user: string) =>
  // eslint-disable-next-line no-restricted-syntax -- the placeholder is a fixed "$n"; the user id is bound
  `(sh.user_id = ${user}::bigint OR sh.role_id IN (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ${user}::bigint
     AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)))`;

const FORM = `SELECT f.id::text, f.code, f.title, f.description, f.respondents, f.fields, f.audience, f.settings, f.status,
       f.academic_year_id::text AS year_id, f.published_at, f.closed_at, f.created_at, f.misc_fee_id::text, f.public_token,
       (SELECT display_name FROM users WHERE id = f.created_by) AS created_by,
       (SELECT count(*) FROM consent_form_responses x WHERE x.form_id = f.id AND x.status <> 'withdrawn')::int AS responses
  FROM consent_forms f`;

const AUDIENCE_DEFAULT: ConsentAudience = {
  pupils: 'all',
  classIds: [],
  sectionIds: [],
  houses: [],
  routeIds: [],
  boarders: false,
  studentIds: [],
  admissionNos: [],
  staff: 'all',
  departments: [],
  designations: [],
  employeeIds: [],
  employeeCodes: [],
};

/** Now as the school's wall clock (YYYY-MM-DDTHH:MM), to compare with a form's window. */
const nowLocal = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);

/**
 * Consent forms (docs/design/28-consent-forms.md): the office builds a form, sends it to families and
 * / or staff (in the app, and by SMS / WhatsApp / email with the school's templates), and reads the
 * register; families answer for each child in the parent app, staff in the staff app, and the office may
 * fill on behalf of either. A response has a number CF/<session>/000001 and a PDF copy. Part 2: an
 * answer may need approval (levels set on the form, the class teacher among them), may carry a fee
 * raised as a misc fee (after approval when there is one), and may be changed until the form's edit date
 * while it is not yet decided, every earlier version kept.
 */
@Injectable()
export class ConsentFormsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly push: PushService,
    private readonly workflow: WorkflowService,
    private readonly requests: RequestsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---- who may open a form -----------------------------------------------------------------------
  /**
   * The caller's access to one form: those holding engagement.consent_form.manage keep every form;
   * anyone else only a form shared with them by name or by a role they hold (docs/design/28, sharing).
   */
  private async accessOf(
    c: PoolClient,
    ctx: RequestContext,
    formId: string,
  ): Promise<Access | null> {
    if (ctx.permissions?.has(CONSENT.manage)) return 'manage';
    const r = await c.query<{ level: 'viewer' | 'editor' | null }>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragment constant; values are bound parameters
      `SELECT CASE WHEN bool_or(sh.level = 'editor') THEN 'editor' WHEN count(*) > 0 THEN 'viewer' END AS level
         FROM consent_form_shares sh WHERE sh.form_id = $1 AND ${SHARED_TO('$2')}`,
      [formId, ctx.user.id],
    );
    return r.rows[0]?.level ?? null;
  }

  /** Refuses unless the caller has at least this access; a form not shared at all is "not found". */
  private async need(c: PoolClient, ctx: RequestContext, formId: string, min: Access) {
    const a = await this.accessOf(c, ctx, formId);
    if (!a) throw new DomainError('not-found', 'Form not found', { status: 404 });
    if (RANK[a] < RANK[min])
      throw new DomainError(
        'consent.no_access',
        min === 'editor'
          ? 'This form is shared with you to view only'
          : 'Only those who manage consent forms may do this',
        { status: 403 },
      );
    return a;
  }

  /** The people and roles a form is shared with, and whom it could be shared with. */
  async shares(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.findDb(c, id);
      const list = await c.query<Row>(
        `SELECT sh.id::text, sh.level, sh.user_id::text AS "userId", sh.role_id::text AS "roleId",
                COALESCE(em.display_name, u.display_name) AS "userName", em.designation, r.name AS "roleName"
           FROM consent_form_shares sh
           LEFT JOIN users u ON u.id = sh.user_id
           LEFT JOIN employees em ON em.user_id = sh.user_id AND em.deleted_at IS NULL
           LEFT JOIN roles r ON r.id = sh.role_id
          WHERE sh.form_id = $1 ORDER BY sh.role_id IS NULL, r.name, "userName"`,
        [id],
      );
      const staff = await c.query<Row>(
        `SELECT user_id::text AS "userId", display_name AS name, designation, employee_code AS code FROM employees
          WHERE user_id IS NOT NULL AND deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 2000`,
      );
      const roles = await c.query<Row>(
        `SELECT DISTINCT ON (code) id::text, code, name FROM roles
          WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND status = 'active' AND deleted_at IS NULL
            AND code NOT IN ('parent', 'student', 'guardian') ORDER BY code, school_id NULLS LAST`,
      );
      return { data: list.rows, staff: staff.rows, roles: roles.rows };
    });
  }

  /** Replaces the form's share list (managers only). */
  async setShares(ctx: RequestContext, id: string, dto: ConsentSharesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.findDb(c, id, true);
      const before = await c.query<Row>(
        `SELECT user_id::text AS "userId", role_id::text AS "roleId", level FROM consent_form_shares WHERE form_id = $1`,
        [id],
      );
      await c.query(`DELETE FROM consent_form_shares WHERE form_id = $1`, [id]);
      const seen = new Set<string>();
      for (const x of dto.shares) {
        const k = x.userId ? `u${x.userId}` : `r${x.roleId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        await c.query(
          `INSERT INTO consent_form_shares (school_id, form_id, user_id, role_id, level, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
          [id, x.userId ?? null, x.roleId ?? null, x.level],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.share',
        entityType: 'consent_forms',
        entityId: id,
        before: before.rows,
        after: dto.shares,
      });
      return { shared: seen.size };
    });
  }

  /** The forms shared with me (for those who do not manage consent forms): to find them from My forms. */
  async sharedWithMe(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragment constant; values are bound parameters
        `SELECT f.id::text, f.title, f.status,
                CASE WHEN bool_or(sh.level = 'editor') THEN 'editor' ELSE 'viewer' END AS level
           FROM consent_form_shares sh JOIN consent_forms f ON f.id = sh.form_id AND f.deleted_at IS NULL AND f.status <> 'archived'
          WHERE ${SHARED_TO('$1')}
          GROUP BY f.id ORDER BY (f.status = 'published') DESC, f.created_at DESC LIMIT 200`,
        [ctx.user.id],
      );
      return { data: r.rows };
    });
  }

  /**
   * The consent dashboard: every form the caller may open (managers: all; others: the shared ones),
   * how far each has got, approvals waiting by approver, fees raised and paid, the classes and
   * departments answering least on the open forms, and answers per day by way of answering.
   */
  async dashboard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const manager = Boolean(ctx.permissions?.has(CONSENT.manage));
      const forms = (
        await c.query<FormDb>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragment constants; values are bound parameters
          `${FORM} WHERE f.deleted_at IS NULL AND f.status IN ('published', 'closed')
             AND ($1::boolean OR EXISTS (SELECT 1 FROM consent_form_shares sh WHERE sh.form_id = f.id AND ${SHARED_TO('$2')}))
           ORDER BY f.created_at DESC LIMIT 200`,
          [manager, ctx.user.id],
        )
      ).rows;
      const ids = forms.map((f) => f.id);
      const today = nowLocal().slice(0, 10);
      const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 864e5)
        .toISOString()
        .slice(0, 10);

      // per form: asked, answered, waiting, fee; and who is asked by class / department (open forms)
      const answeredBy = await c.query<{ form_id: string; s: string | null; e: string | null }>(
        `SELECT form_id::text, student_id::text AS s, employee_id::text AS e FROM consent_form_responses
          WHERE form_id = ANY($1::bigint[]) AND status <> 'withdrawn'`,
        [ids],
      );
      const rows = [];
      const askedS = new Map<string, Set<string>>(); // pupil -> open forms asking
      const doneS = new Map<string, Set<string>>();
      const askedE = new Map<string, Set<string>>();
      const doneE = new Map<string, Set<string>>();
      for (const f of forms) {
        f.audience = { ...AUDIENCE_DEFAULT, ...f.audience };
        const state = this.openState(f);
        const pupils = await this.audienceStudents(c, f);
        const staff = await this.audienceStaff(c, f);
        const mine = answeredBy.rows.filter((x) => x.form_id === f.id);
        // public-link answers carry no pupil or staff member: each counts once
        const ans = new Set(mine.map((x, i) => (x.s ? `s${x.s}` : x.e ? `e${x.e}` : `r${i}`)));
        if (state.open) {
          for (const id of pupils) (askedS.get(id) ?? askedS.set(id, new Set()).get(id)!).add(f.id);
          for (const id of staff) (askedE.get(id) ?? askedE.set(id, new Set()).get(id)!).add(f.id);
          for (const x of mine) {
            if (x.s) (doneS.get(x.s) ?? doneS.set(x.s, new Set()).get(x.s)!).add(f.id);
            if (x.e) (doneE.get(x.e) ?? doneE.set(x.e, new Set()).get(x.e)!).add(f.id);
          }
        }
        rows.push({
          id: f.id,
          title: f.title,
          status: f.status,
          open: state.open,
          closedWhy: state.why,
          closesAt: f.settings.closesAt ?? null,
          closingSoon: Boolean(
            state.open && f.settings.closesAt && f.settings.closesAt.slice(0, 10) <= soon,
          ),
          asked: pupils.length + staff.length,
          answered: ans.size,
        });
      }
      const extra = await c.query<{
        form_id: string;
        waiting: number;
        approved: number;
        rejected: number;
        raised: string;
        paid: string;
        via_app: number;
        via_link: number;
        via_office: number;
      }>(
        `SELECT x.form_id::text,
                count(*) FILTER (WHERE x.status = 'submitted' AND EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending'))::int AS waiting,
                count(*) FILTER (WHERE x.status = 'approved')::int AS approved,
                count(*) FILTER (WHERE x.status = 'rejected')::int AS rejected,
                COALESCE(sum(l.amount), 0)::text AS raised, COALESCE(sum(l.paid), 0)::text AS paid,
                count(*) FILTER (WHERE NOT x.via_link AND x.respondent IN ('family', 'staff'))::int AS via_app,
                count(*) FILTER (WHERE x.via_link)::int AS via_link,
                count(*) FILTER (WHERE x.respondent = 'office')::int AS via_office
           FROM consent_form_responses x LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id AND l.status <> 'cancelled'
          WHERE x.form_id = ANY($1::bigint[]) AND x.status <> 'withdrawn' GROUP BY x.form_id`,
        [ids],
      );
      const formRows = rows.map((r) => {
        const e = extra.rows.find((x) => x.form_id === r.id);
        return {
          ...r,
          rate: r.asked ? Math.round((Math.min(r.answered, r.asked) / r.asked) * 100) : null,
          waiting: e?.waiting ?? 0,
          approved: e?.approved ?? 0,
          rejected: e?.rejected ?? 0,
          feeRaised: Number(e?.raised ?? 0),
          feePaid: Number(e?.paid ?? 0),
        };
      });
      const open = formRows.filter((r) => r.open);

      // approvals waiting, by the step and those who hold it
      const approvers = await c.query<{ who: string; n: number; oldest: string }>(
        // eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed expression; values are bound
        `SELECT ${WAITING_WITH('x.instance_id')} AS who, count(*)::int AS n, min(x.signed_at)::text AS oldest
           FROM consent_form_responses x
          WHERE x.form_id = ANY($1::bigint[]) AND x.status = 'submitted'
            AND EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending')
          GROUP BY 1 ORDER BY 2 DESC`,
        [ids],
      );

      // the classes and departments on the open forms: asked (person x form) and answered
      const byClass = await c.query<{ id: string; name: string; ord: number }>(
        `SELECT s.id::text, k.name, k.display_order AS ord FROM students s
           JOIN enrolments e ON e.student_id = s.id AND e.status = 'active'
            AND e.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE s.id = ANY($1::bigint[])`,
        [[...askedS.keys()]],
      );
      const classAgg = new Map<
        string,
        { name: string; ord: number; asked: number; answered: number }
      >();
      for (const r of byClass.rows) {
        const a = classAgg.get(r.name) ?? { name: r.name, ord: r.ord, asked: 0, answered: 0 };
        a.asked += askedS.get(r.id)?.size ?? 0;
        a.answered += [...(askedS.get(r.id) ?? [])].filter((f) => doneS.get(r.id)?.has(f)).length;
        classAgg.set(r.name, a);
      }
      const byDept = await c.query<{ id: string; dept: string }>(
        `SELECT id::text, COALESCE(NULLIF(department, ''), 'No department') AS dept FROM employees WHERE id = ANY($1::bigint[])`,
        [[...askedE.keys()]],
      );
      const deptAgg = new Map<string, { name: string; asked: number; answered: number }>();
      for (const r of byDept.rows) {
        const a = deptAgg.get(r.dept) ?? { name: r.dept, asked: 0, answered: 0 };
        a.asked += askedE.get(r.id)?.size ?? 0;
        a.answered += [...(askedE.get(r.id) ?? [])].filter((f) => doneE.get(r.id)?.has(f)).length;
        deptAgg.set(r.dept, a);
      }
      const withRate = <T extends { asked: number; answered: number }>(x: T) => ({
        ...x,
        rate: x.asked ? Math.round((x.answered / x.asked) * 100) : 0,
      });

      // answers per day, the last 30 days, by way of answering
      const daily = await c.query<{ date: string; app: number; link: number; office: number }>(
        `SELECT g.d::date::text AS date,
                count(x.id) FILTER (WHERE NOT x.via_link AND x.respondent IN ('family', 'staff'))::int AS app,
                count(x.id) FILTER (WHERE x.via_link)::int AS link,
                count(x.id) FILTER (WHERE x.respondent = 'office')::int AS office
           FROM generate_series($2::date - 29, $2::date, interval '1 day') g(d)
           LEFT JOIN consent_form_responses x ON x.form_id = ANY($1::bigint[]) AND x.status <> 'withdrawn'
            AND (x.signed_at AT TIME ZONE 'Asia/Kolkata')::date = g.d::date
          GROUP BY g.d ORDER BY g.d`,
        [ids, today],
      );
      const ways = extra.rows.reduce(
        (a, x) => ({
          app: a.app + x.via_app,
          link: a.link + x.via_link,
          office: a.office + x.via_office,
        }),
        { app: 0, link: 0, office: 0 },
      );

      const asked = open.reduce((n, r) => n + r.asked, 0);
      const answered = open.reduce((n, r) => n + Math.min(r.answered, r.asked), 0);
      return {
        canCreate: manager,
        totals: {
          open: open.length,
          closingSoon: open.filter((r) => r.closingSoon).length,
          asked,
          answered,
          rate: asked ? Math.round((answered / asked) * 100) : 0,
          waiting: formRows.reduce((n, r) => n + r.waiting, 0),
          feeRaised: formRows.reduce((n, r) => n + r.feeRaised, 0),
          feePaid: formRows.reduce((n, r) => n + r.feePaid, 0),
        },
        forms: formRows,
        lowest: [...open]
          .filter((r) => r.asked > 0)
          .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
          .slice(0, 5),
        approvers: approvers.rows.map((x) => ({
          who: x.who ?? 'Not assigned',
          count: x.n,
          oldest: x.oldest,
        })),
        byClass: [...classAgg.values()]
          .sort((a, b) => a.ord - b.ord)
          .map(({ ord: _o, ...x }) => withRate(x)),
        byDepartment: [...deptAgg.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(withRate),
        daily: daily.rows,
        ways,
      };
    });
  }

  // ---- reading ----------------------------------------------------------------------------------
  private async findDb(c: PoolClient, id: string, lock = false): Promise<FormDb> {
    const r = await c.query<FormDb>(
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      `${FORM} WHERE f.id = $1 AND f.deleted_at IS NULL${lock ? ' FOR UPDATE OF f' : ''}`,
      [id],
    );
    const f = r.rows[0];
    if (!f) throw new DomainError('not-found', 'Form not found', { status: 404 });
    f.audience = { ...AUDIENCE_DEFAULT, ...f.audience };
    return f;
  }

  /** The form behind a public link (its secret part), with the link switched on. */
  async formByToken(c: PoolClient, token: string): Promise<FormDb> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM consent_forms WHERE public_token = $1 AND deleted_at IS NULL`,
      [token],
    );
    const f = r.rows[0] ? await this.findDb(c, r.rows[0].id) : null;
    if (!f || !f.settings.publicLink?.on || f.status === 'draft' || f.status === 'archived')
      throw new DomainError('not-found', 'This form link is not valid', { status: 404 });
    return f;
  }

  /** The pupils a form asks, for the public link (exported for the link's service). */
  studentsAsked(c: PoolClient, f: FormDb) {
    return this.audienceStudents(c, f);
  }

  /** Is the form open, and why not (for the link's service). */
  stateOf(f: FormDb) {
    return this.openState(f);
  }

  /** Is the form taking answers now, and why not? */
  private openState(f: FormDb): { open: boolean; why: string | null } {
    if (f.status !== 'published')
      return { open: false, why: f.status === 'draft' ? 'not published yet' : 'closed' };
    const now = nowLocal();
    if (f.settings.opensAt && now < f.settings.opensAt)
      return { open: false, why: `opens on ${f.settings.opensAt.replace('T', ' ')}` };
    if (f.settings.closesAt && now > f.settings.closesAt) return { open: false, why: 'closed' };
    if (f.settings.cap && f.responses >= f.settings.cap)
      return { open: false, why: 'all places are taken' };
    return { open: true, why: null };
  }

  private view(f: FormDb, extra: Record<string, unknown> = {}) {
    const state = this.openState(f);
    return {
      id: f.id,
      code: f.code,
      title: f.title,
      description: f.description,
      respondents: f.respondents,
      fields: f.fields,
      audience: f.audience,
      settings: f.settings,
      status: f.status,
      open: state.open,
      closedWhy: state.why,
      responses: f.responses,
      publishedAt: f.published_at,
      closedAt: f.closed_at,
      createdAt: f.created_at,
      createdBy: f.created_by,
      publicToken: f.settings.publicLink?.on ? f.public_token : null,
      ...extra,
    };
  }

  /** The pupils a form asks (this session). */
  private async audienceStudents(c: PoolClient, f: FormDb): Promise<string[]> {
    if (f.respondents === 'staff') return [];
    const a = f.audience;
    if (a.pupils === 'pupils') {
      const r = await c.query<{ id: string }>(
        `SELECT s.id::text FROM students s JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
          WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL AND s.status = 'active'`,
        [a.studentIds, f.year_id],
      );
      return r.rows.map((x) => x.id);
    }
    let ids = await studentsByRule(
      c,
      f.year_id,
      a.pupils === 'filter'
        ? {
            people: 'students',
            classIds: a.classIds,
            sectionIds: a.sectionIds,
            houses: a.houses,
            routeIds: a.routeIds,
          }
        : { people: 'students' },
    );
    if (a.pupils === 'filter' && a.boarders) {
      const b = await c.query<{ id: string }>(
        `SELECT DISTINCT student_id::text AS id FROM hostel_allotments
          WHERE from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND (to_date IS NULL OR to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
      );
      const set = new Set(b.rows.map((x) => x.id));
      ids = ids.filter((x) => set.has(x));
    }
    return ids;
  }

  /** The staff a form asks. */
  private async audienceStaff(c: PoolClient, f: FormDb): Promise<string[]> {
    if (f.respondents === 'family') return [];
    const a = f.audience;
    if (a.staff === 'people') {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active'`,
        [a.employeeIds],
      );
      return r.rows.map((x) => x.id);
    }
    return employeesByRule(
      c,
      a.staff === 'filter'
        ? { people: 'employees', departments: a.departments, designations: a.designations }
        : { people: 'employees' },
    );
  }

  async list(ctx: RequestContext, q: ConsentListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where = ['f.deleted_at IS NULL'];
      if (q.status !== 'all') {
        params.push(q.status);
        where.push(`f.status = $${params.length}`);
      } else where.push(`f.status <> 'archived'`);
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`f.title ILIKE $${params.length}`);
      }
      const manager = Boolean(ctx.permissions?.has(CONSENT.manage));
      if (!manager) {
        params.push(ctx.user.id);
        where.push(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragment constant; values are bound parameters
          `EXISTS (SELECT 1 FROM consent_form_shares sh WHERE sh.form_id = f.id AND ${SHARED_TO(`$${params.length}`)})`,
        );
      }
      const r = await c.query<FormDb>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
        `${FORM} WHERE ${where.join(' AND ')} ORDER BY (f.status = 'published') DESC, f.created_at DESC LIMIT 300`,
        params,
      );
      const data = [];
      for (const f of r.rows) {
        f.audience = { ...AUDIENCE_DEFAULT, ...f.audience };
        const asked =
          f.status === 'draft'
            ? null
            : (await this.audienceStudents(c, f)).length + (await this.audienceStaff(c, f)).length;
        const answered = await this.answeredCount(c, f.id);
        data.push(this.view(f, { asked, answered }));
      }
      return { data, canCreate: manager };
    });
  }

  private async answeredCount(c: PoolClient, id: string) {
    const r = await c.query<{ n: number }>(
      `SELECT count(DISTINCT COALESCE('s' || student_id, 'e' || employee_id, 'r' || id))::int AS n
         FROM consent_form_responses WHERE form_id = $1 AND status <> 'withdrawn'`,
      [id],
    );
    return r.rows[0]?.n ?? 0;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // the school's consent message templates exist before Publish lists them
      await c.query(`SELECT app.consent_seed_templates(app.current_school_id())`);
      const access = await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      const pupils = await this.audienceStudents(c, f);
      const staff = await this.audienceStaff(c, f);
      const answered = await this.answeredCount(c, id);
      const lists = await sourceOptions(c, f.fields);
      // the consent message templates, for Publish / Remind by those who cannot open Message templates
      const templates = await c.query<Row>(
        `SELECT id::text, name, channel, code, dlt_template_id AS "dltTemplateId", wa_template_name AS "waTemplateName"
           FROM comms_templates
          WHERE code LIKE 'consent_form_%' AND channel IN ('sms', 'whatsapp', 'email') AND status = 'active' AND deleted_at IS NULL
          ORDER BY channel, name`,
      );
      return this.view(f, {
        asked: pupils.length + staff.length,
        answered,
        lists,
        access,
        templates: templates.rows,
      });
    });
  }

  /** The school lists the builder offers: classes, sections, houses, routes, departments, designations. */
  async builderLists(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!ctx.permissions?.has(CONSENT.manage)) {
        const r = await c.query(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragment constant; values are bound parameters
          `SELECT 1 FROM consent_form_shares sh WHERE ${SHARED_TO('$1')} LIMIT 1`,
          [ctx.user.id],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'Not found', { status: 404 });
      }
      const q = async (sql: string) => (await c.query<Row>(sql)).rows;
      return {
        classes: await q(
          `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
        ),
        sections: await q(
          `SELECT cs.id::text, c.name || '-' || cs.name AS name FROM class_sections cs JOIN classes c ON c.id = cs.class_id
            WHERE cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL ORDER BY c.display_order, cs.name`,
        ),
        houses: (
          await q(
            `SELECT DISTINCT house AS name FROM students WHERE house IS NOT NULL AND house <> '' AND deleted_at IS NULL ORDER BY 1`,
          )
        ).map((x) => x.name),
        routes: await q(
          `SELECT id::text, name FROM transport_routes WHERE deleted_at IS NULL ORDER BY name`,
        ),
        departments: (
          await q(
            `SELECT DISTINCT department AS name FROM employees WHERE department IS NOT NULL AND department <> '' AND deleted_at IS NULL ORDER BY 1`,
          )
        ).map((x) => x.name),
        designations: (
          await q(
            `SELECT DISTINCT designation AS name FROM employees WHERE designation IS NOT NULL AND designation <> '' AND deleted_at IS NULL ORDER BY 1`,
          )
        ).map((x) => x.name),
        // approvers: roles and staff with a login
        roles: await q(
          `SELECT DISTINCT ON (code) code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND status = 'active' AND code NOT IN ('parent', 'student', 'guardian')
            ORDER BY code, school_id NULLS LAST`,
        ),
        staff: await q(
          `SELECT user_id::text AS "userId", display_name AS name, designation FROM employees
            WHERE user_id IS NOT NULL AND deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 1000`,
        ),
      };
    });
  }

  // ---- building ---------------------------------------------------------------------------------
  /** Pupils named by admission number and staff by code become ids; an unknown one is refused. */
  private async resolveAudience(c: PoolClient, a: ConsentAudience): Promise<ConsentAudience> {
    const out = { ...a };
    if (a.pupils === 'pupils' && a.admissionNos.length) {
      const r = await c.query<{ id: string; no: string }>(
        `SELECT id::text, admission_no AS no FROM students WHERE admission_no = ANY($1::text[]) AND deleted_at IS NULL`,
        [a.admissionNos],
      );
      const missing = a.admissionNos.filter((n) => !r.rows.some((x) => x.no === n));
      if (missing.length)
        throw new DomainError(
          'consent.unknown_pupils',
          `No pupil has the admission number ${missing.slice(0, 10).join(', ')}`,
          { status: 400 },
        );
      out.studentIds = r.rows.map((x) => x.id);
    }
    if (a.staff === 'people' && a.employeeCodes.length) {
      const r = await c.query<{ id: string; code: string }>(
        `SELECT id::text, employee_code AS code FROM employees WHERE employee_code = ANY($1::text[]) AND deleted_at IS NULL`,
        [a.employeeCodes],
      );
      const missing = a.employeeCodes.filter((n) => !r.rows.some((x) => x.code === n));
      if (missing.length)
        throw new DomainError(
          'consent.unknown_staff',
          `No staff member has the code ${missing.slice(0, 10).join(', ')}`,
          { status: 400 },
        );
      out.employeeIds = r.rows.map((x) => x.id);
    }
    return out;
  }

  private async codeFor(c: PoolClient, title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32) || 'form';
    const taken = await c.query<{ code: string }>(
      `SELECT code FROM consent_forms WHERE code = $1 OR code LIKE $1 || '\\_%'`,
      [base],
    );
    const set = new Set(taken.rows.map((x) => x.code));
    if (!set.has(base)) return base;
    for (let i = 2; ; i += 1) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
  }

  async create(ctx: RequestContext, dto: ConsentFormDto) {
    checkFields(dto.fields);
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      const code = await this.codeFor(c, dto.title);
      const audience = await this.resolveAudience(c, dto.audience);
      const r = await c.query<{ id: string }>(
        `INSERT INTO consent_forms (school_id, academic_year_id, code, title, description, respondents, fields, audience, settings, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          tenant.academicYearId,
          code,
          dto.title,
          dto.description ?? null,
          dto.respondents,
          JSON.stringify(dto.fields),
          JSON.stringify(audience),
          JSON.stringify(dto.settings),
        ],
      );
      const id = r.rows[0]!.id;
      await syncFlows(c, { id, title: dto.title, approval: dto.settings.approval });
      if (dto.settings.publicLink?.on) await this.ensureToken(c, id, false);
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.create',
        entityType: 'consent_forms',
        entityId: id,
        after: { title: dto.title, fields: dto.fields.length, respondents: dto.respondents },
      });
      return this.view(await this.findDb(c, id));
    });
  }

  /**
   * Saves a form. Once answers exist, a field may be added or reworded, never removed or given another
   * type, so the answers already in keep their meaning; who answers stays as it was.
   */
  async update(ctx: RequestContext, id: string, dto: ConsentFormDto) {
    checkFields(dto.fields);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'editor');
      const f = await this.findDb(c, id, true);
      if (f.status === 'archived')
        throw new DomainError('consent.archived', 'An archived form cannot change', {
          status: 409,
        });
      if (f.responses > 0) {
        for (const old of f.fields) {
          if (LAYOUT.includes(old.type)) continue;
          const now = dto.fields.find((x) => x.key === old.key);
          if (!now)
            throw new DomainError(
              'consent.field_removed',
              `"${old.label}" already has answers: it cannot be removed (hide it with a rule instead)`,
              { status: 409 },
            );
          if (now.type !== old.type)
            throw new DomainError(
              'consent.field_type',
              `"${old.label}" already has answers: its type cannot change`,
              { status: 409 },
            );
        }
        if (dto.respondents !== f.respondents)
          throw new DomainError(
            'consent.respondents',
            'The form already has answers: who answers it cannot change',
            { status: 409 },
          );
      }
      const audience = await this.resolveAudience(c, dto.audience);
      await c.query(
        `UPDATE consent_forms SET title = $2, description = $3, respondents = $4, fields = $5::jsonb, audience = $6::jsonb, settings = $7::jsonb,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [
          id,
          dto.title,
          dto.description ?? null,
          dto.respondents,
          JSON.stringify(dto.fields),
          JSON.stringify(audience),
          JSON.stringify(dto.settings),
        ],
      );
      await syncFlows(c, { id, title: dto.title, approval: dto.settings.approval });
      if (dto.settings.publicLink?.on) await this.ensureToken(c, id, false);
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.update',
        entityType: 'consent_forms',
        entityId: id,
        before: { title: f.title, fields: f.fields.length },
        after: { title: dto.title, fields: dto.fields.length },
      });
      return this.view(await this.findDb(c, id));
    });
  }

  /** The public link's secret part (a new one makes the old link and QR stop working). */
  private async ensureToken(c: PoolClient, id: string, rotate: boolean) {
    await c.query(
      `UPDATE consent_forms SET public_token = translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_')
        WHERE id = $1 AND ($2 OR public_token IS NULL)`,
      [id, rotate],
    );
  }

  /** A new public link: the old link and QR stop working. */
  async rotateLink(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'editor');
      const f = await this.findDb(c, id, true);
      if (!f.settings.publicLink?.on)
        throw new DomainError('consent.no_link', 'The public link is off for this form', {
          status: 409,
        });
      await this.ensureToken(c, id, true);
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.link',
        entityType: 'consent_forms',
        entityId: id,
      });
      return this.view(await this.findDb(c, id));
    });
  }

  /** The QR of the public link (PNG, base64), and the link itself. */
  async qr(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      if (!f.settings.publicLink?.on || !f.public_token)
        throw new DomainError('consent.no_link', 'The public link is off for this form', {
          status: 409,
        });
      const code = await c.query<{ code: string }>(
        `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      );
      const url = `${base}/${code.rows[0]!.code}/consent/${f.public_token}`;
      return {
        url,
        filename: `${f.code}-qr.png`,
        contentType: 'image/png',
        base64: (await qrPng(url)).toString('base64'),
      };
    });
  }

  /** A new draft with the same fields, audience and settings (no answers). */
  async copy(ctx: RequestContext, id: string) {
    const f = await this.db.tenant(requireTenant(ctx), (c) => this.findDb(c, id));
    return this.create(ctx, {
      title: `${f.title} (copy)`.slice(0, 200),
      description: f.description ?? undefined,
      respondents: f.respondents,
      fields: f.fields,
      audience: f.audience,
      settings: f.settings,
    });
  }

  /**
   * Publish (tells the audience in the app, and by SMS / WhatsApp / email when templates are chosen),
   * close, reopen as draft (no answers yet) or archive.
   */
  async setStatus(ctx: RequestContext, id: string, dto: ConsentStatusDto) {
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'editor');
      const f = await this.findDb(c, id, true);
      if (dto.status === f.status) return { view: this.view(f), pending: null, f };
      if (dto.status === 'draft' && f.responses > 0)
        throw new DomainError(
          'consent.has_answers',
          'The form has answers: close it instead of making it a draft',
          { status: 409 },
        );
      if (dto.status === 'published') {
        const asked =
          (await this.audienceStudents(c, f)).length + (await this.audienceStaff(c, f)).length;
        if (!asked)
          throw new DomainError('consent.no_audience', 'Nobody is in the audience of this form', {
            status: 409,
          });
      }
      await c.query(
        `UPDATE consent_forms SET status = $2,
                published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
                closed_at = CASE WHEN $2 = 'closed' THEN now() WHEN $2 = 'published' THEN NULL ELSE closed_at END,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.status],
      );
      let told = 0;
      let pending: { students: string[]; staff: string[] } | null = null;
      if (dto.status === 'published' && f.status === 'draft') {
        pending = await this.pendingPeople(c, f);
        if (dto.push) told = await this.tell(c, ctx, f, pending, 'New form to answer');
      }
      await this.audit.stage(ctx, c, {
        action: `engagement.consent_form.${dto.status}`,
        entityType: 'consent_forms',
        entityId: id,
        before: { status: f.status },
        after: { status: dto.status, told, channels: dto.channels.map((x) => x.channel) },
      });
      const now = await this.findDb(c, id);
      return { view: this.view(now, { told }), pending, f: now };
    });
    const messages =
      out.pending && dto.channels.length
        ? await this.sendMessages(ctx, out.f, out.pending, dto.channels, false)
        : [];
    return { ...out.view, messages };
  }

  /** Who is asked and has not answered yet (everyone asked, when several answers are allowed). */
  private async pendingPeople(c: PoolClient, f: FormDb) {
    const pupils = await this.audienceStudents(c, f);
    const staff = await this.audienceStaff(c, f);
    const done = await c.query<{ s: string | null; e: string | null }>(
      `SELECT student_id::text AS s, employee_id::text AS e FROM consent_form_responses WHERE form_id = $1 AND status <> 'withdrawn'`,
      [f.id],
    );
    const doneS = new Set(done.rows.map((x) => x.s));
    const doneE = new Set(done.rows.map((x) => x.e));
    return {
      students: f.settings.repeat === 'many' ? pupils : pupils.filter((x) => !doneS.has(x)),
      staff: f.settings.repeat === 'many' ? staff : staff.filter((x) => !doneE.has(x)),
    };
  }

  /** An app notification to the families and staff not answered yet. */
  private async tell(
    c: PoolClient,
    ctx: RequestContext,
    f: FormDb,
    people: { students: string[]; staff: string[] },
    title: string,
  ) {
    const users = await c.query<{ id: string }>(
      `SELECT g.user_id::text AS id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = ANY($1::bigint[]) AND g.user_id IS NOT NULL AND g.deleted_at IS NULL
       UNION SELECT user_id::text FROM employees WHERE id = ANY($2::bigint[]) AND user_id IS NOT NULL`,
      [people.students, people.staff],
    );
    if (!users.rows.length) return 0;
    return this.push.send(c, ctx, {
      userIds: users.rows.map((x) => x.id),
      title,
      body: f.title,
      link: '/consents',
      event: 'notices',
    });
  }

  /**
   * SMS / WhatsApp / email to the families (the parents of each pupil) and staff not answered yet, with
   * the school's templates (by default consent_form_new / consent_form_reminder): one message request
   * per channel, so a channel switched off or refused does not stop the others. Each request may wait
   * for message approval. Returns what became of each channel; never fails the form.
   */
  private async sendMessages(
    ctx: RequestContext,
    f: { id: string; title: string; settings: ConsentSettings; public_token: string | null },
    people: { students: string[]; staff: string[] },
    channels: Array<{ channel: 'sms' | 'whatsapp' | 'email'; templateId: string }>,
    reminder: boolean,
  ): Promise<
    Array<{ channel: string; id?: string; status?: string; people?: number; error?: string }>
  > {
    const targets = [
      ...people.students.map((id) => ({ type: 'student' as const, id })),
      ...people.staff.map((id) => ({ type: 'employee' as const, id })),
    ].slice(0, 5000);
    if (!targets.length)
      return channels.map((c) => ({ channel: c.channel, error: 'Everyone asked has answered' }));
    const school = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ name: string; code: string }>(
        `SELECT name, lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      );
      return r.rows[0]!;
    });
    const link =
      f.settings.publicLink?.on && f.public_token
        ? `${this.env.PUBLIC_APP_URL}/${school.code}/consent/${f.public_token}`
        : `${this.env.PARENT_APP_URL}/consents`;
    const closes = f.settings.closesAt
      ? ` by ${f.settings.closesAt.slice(8, 10)}-${f.settings.closesAt.slice(5, 7)}-${f.settings.closesAt.slice(0, 4)}`
      : '';
    const out: Array<{
      channel: string;
      id?: string;
      status?: string;
      people?: number;
      error?: string;
    }> = [];
    for (const ch of channels) {
      try {
        const r = await this.requests.create(
          ctx,
          {
            title: `${reminder ? 'Reminder: ' : ''}${f.title}`.slice(0, 160),
            category: 'service',
            channels: [ch],
            body: `${reminder ? 'Reminder: please' : 'Please'} answer the form "${f.title}"${closes}: ${link}`,
            bodyFormat: 'text',
            subject: `${reminder ? 'Reminder: ' : ''}${f.title}`.slice(0, 200),
            variables: {
              school: school.name,
              form_title: f.title.slice(0, 120),
              closes_on: closes,
              link,
            },
            audience: 'individuals',
            targets,
            sendTo: 'parents',
            attachments: [],
          } as CreateRequestDto,
          // publishing (or reminding) the form is the approval: no wait in message requests
          { preApproved: true },
        );
        out.push({ channel: ch.channel, id: r.id, status: r.status, people: targets.length });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        out.push({ channel: ch.channel, error: error.message });
      }
    }
    return out;
  }

  /**
   * Tell again those who have not answered: the ticked people (only those still pending), else all
   * pending in the section / search given, else everyone pending; in the app and / or by the channels.
   */
  async notifyPending(ctx: RequestContext, id: string, dto: Partial<ConsentNotifyDto> = {}) {
    const channels = dto.channels ?? [];
    const app = dto.app ?? true;
    if (!app && !channels.length)
      throw new DomainError('consent.no_channel', 'Choose the app or at least one channel', {
        status: 400,
      });
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      if (!this.openState(f).open)
        throw new DomainError('consent.not_open', 'The form is not taking answers', {
          status: 409,
        });
      const rows = (
        await this.pendingRows(
          c,
          f,
          { tab: 'pending', sectionId: dto.sectionId, q: dto.q, page: 1, size: 1 },
          true,
        )
      ).rows as Array<{ kind: string; id: string }>;
      const ticked = dto.people?.length
        ? new Set(dto.people.map((x) => `${x.kind}:${x.id}`))
        : null;
      const chosen = ticked ? rows.filter((x) => ticked.has(`${x.kind}:${x.id}`)) : rows;
      if (!chosen.length)
        throw new DomainError('consent.nobody', 'Nobody chosen is still to answer', {
          status: 409,
        });
      const pending = {
        students: chosen.filter((x) => x.kind === 'student').map((x) => x.id),
        staff: chosen.filter((x) => x.kind === 'employee').map((x) => x.id),
      };
      const told = app
        ? await this.tell(c, ctx, f, pending, 'Reminder: a form waits for your answer')
        : 0;
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.notify',
        entityType: 'consent_forms',
        entityId: id,
        after: {
          people: chosen.length,
          ticked: Boolean(ticked),
          app,
          told,
          channels: channels.map((x) => x.channel),
        },
      });
      return { f, pending, told, people: chosen.length };
    });
    const messages = channels.length
      ? await this.sendMessages(ctx, out.f, out.pending, channels, true)
      : [];
    return { people: out.people, told: out.told, messages };
  }

  /** A draft with no answers is removed; anything else is archived. */
  async remove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.findDb(c, id, true);
      if (f.status !== 'draft' || f.responses > 0)
        throw new DomainError('consent.not_draft', 'Only a draft without answers can be deleted', {
          status: 409,
        });
      await c.query(`UPDATE consent_forms SET deleted_at = now() WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.delete',
        entityType: 'consent_forms',
        entityId: id,
        before: { title: f.title },
      });
      return { ok: true };
    });
  }

  // ---- the register -----------------------------------------------------------------------------
  private async answeredRows(c: PoolClient, f: FormDb, q: ConsentRegisterQueryDto, all = false) {
    const params: unknown[] = [f.id, f.year_id];
    const where = [`x.form_id = $1`, `x.status <> 'withdrawn'`];
    if (q.sectionId) {
      params.push(q.sectionId);
      where.push(`e.class_section_id = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(
        `(s.display_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length} OR em.display_name ILIKE $${params.length} OR x.number ILIKE $${params.length}
          OR x.public_name ILIKE $${params.length} OR x.public_mobile ILIKE $${params.length})`,
      );
    }
    if (q.status === 'waiting')
      where.push(
        `x.status = 'submitted' AND EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending')`,
      );
    else if (q.status) {
      params.push(q.status);
      where.push(`x.status = $${params.length}`);
    }
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const base = `FROM consent_form_responses x
        LEFT JOIN students s ON s.id = x.student_id
        LEFT JOIN enrolments e ON e.student_id = x.student_id AND e.academic_year_id = $2 AND e.status = 'active'
        LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
        LEFT JOIN employees em ON em.id = x.employee_id
        LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id
       WHERE ${where.join(' AND ')}`;
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const total = (await c.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params))
      .rows[0]!.n;
    if (!all) params.push(q.size, (q.page - 1) * q.size);
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const limit = all ? '' : `LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const rows = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
      `SELECT x.id::text, x.number, x.respondent, x.status, x.answers, x.signed_name AS "signedName", x.signed_at AS "signedAt",
              x.student_id::text AS "studentId", s.display_name AS student, s.admission_no AS "admissionNo",
              CASE WHEN k.id IS NOT NULL THEN k.name || '-' || cs.name END AS section,
              x.employee_id::text AS "employeeId", em.display_name AS employee, em.employee_code AS "employeeCode",
              (SELECT display_name FROM users WHERE id = x.signed_by) AS "byUser",
              (SELECT display_name FROM users WHERE id = x.entered_by) AS "enteredBy",
              x.fee_amount::text AS fee, l.paid::text AS paid, x.decided_note AS "decidedNote", x.edits,
              x.via_link AS "viaLink", x.public_name AS "publicName", x.public_mobile AS "publicMobile", x.public_email AS "publicEmail",
              ${WAITING_WITH('x.instance_id')} AS "waitingWith"
         ${base} ORDER BY x.signed_at DESC, x.id DESC ${limit}`,
      params,
    );
    return { total, rows: rows.rows };
  }

  private async pendingRows(c: PoolClient, f: FormDb, q: ConsentRegisterQueryDto, all = false) {
    const pupils = await this.audienceStudents(c, f);
    const staff = await this.audienceStaff(c, f);
    const params: unknown[] = [f.id, f.year_id, pupils, staff];
    const filters: string[] = [];
    if (q.sectionId) {
      params.push(q.sectionId);
      filters.push(`section_id = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      filters.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const filterSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const base = `WITH people AS (
        SELECT 'student' AS kind, s.id::text AS id, s.display_name AS name, s.admission_no AS code,
               k.name || '-' || cs.name AS section, cs.id::text AS section_id, k.display_order AS ord,
               (SELECT string_agg(DISTINCT g.mobile, ', ') FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                 WHERE sg.student_id = s.id AND g.deleted_at IS NULL AND g.mobile IS NOT NULL) AS contact
          FROM students s JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
          JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
         WHERE s.id = ANY($3::bigint[])
           AND NOT EXISTS (SELECT 1 FROM consent_form_responses x WHERE x.form_id = $1 AND x.student_id = s.id AND x.status <> 'withdrawn')
        UNION ALL
        SELECT 'employee', em.id::text, em.display_name, em.employee_code, COALESCE(em.department, 'Staff'), NULL, 9999, em.mobile
          FROM employees em WHERE em.id = ANY($4::bigint[])
           AND NOT EXISTS (SELECT 1 FROM consent_form_responses x WHERE x.form_id = $1 AND x.employee_id = em.id AND x.status <> 'withdrawn'))
      SELECT * FROM people ${filterSql}`;
    const total =
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
      (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) t`, params)).rows[0]!
        .n;
    if (!all) params.push(q.size, (q.page - 1) * q.size);
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
    const limit = all ? '' : `LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const rows = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
      `${base} ORDER BY ord, section, name ${limit}`,
      params,
    );
    return { total, rows: rows.rows };
  }

  async register(ctx: RequestContext, id: string, q: ConsentRegisterQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      const r =
        q.tab === 'answered' ? await this.answeredRows(c, f, q) : await this.pendingRows(c, f, q);
      if (q.tab === 'answered') return { total: r.total, page: q.page, size: q.size, data: r.rows };
      // how many of those pending (all pages, this filter) each way of reminding reaches
      const all = (await this.pendingRows(c, f, q, true)).rows as Array<{
        kind: string;
        id: string;
      }>;
      const st = all.filter((x) => x.kind === 'student').map((x) => x.id);
      const em = all.filter((x) => x.kind === 'employee').map((x) => x.id);
      const reach = await c.query<{ app: number; mobile: number; email: number }>(
        `WITH p AS (
           SELECT sg.student_id AS who, g.user_id, g.mobile, g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = ANY($1::bigint[]) AND g.deleted_at IS NULL
           UNION ALL SELECT -em.id, em.user_id, em.mobile, em.email FROM employees em WHERE em.id = ANY($2::bigint[]))
         SELECT count(DISTINCT who) FILTER (WHERE user_id IS NOT NULL)::int AS app,
                count(DISTINCT who) FILTER (WHERE mobile IS NOT NULL AND mobile <> '')::int AS mobile,
                count(DISTINCT who) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS email FROM p`,
        [st, em],
      );
      return {
        total: r.total,
        page: q.page,
        size: q.size,
        data: r.rows,
        reach: { people: all.length, ...reach.rows[0]! },
      };
    });
  }

  async registerFile(ctx: RequestContext, id: string, q: ConsentFileQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      const head = await schoolHead(c);
      const fields = f.fields.filter((x) => !LAYOUT.includes(x.type));
      if (q.tab === 'pending') {
        const r = await this.pendingRows(c, f, q, true);
        return registerFile(
          {
            school: head.name,
            address: head.address,
            report: `Not yet answered: ${f.title}`,
            details: [`${r.total} to answer`, generatedOn()],
            legend: 'Pupils and staff asked by the form who have not answered.',
            columns: [
              { label: 'Sl.', width: 3, right: true },
              { label: 'Name', width: 16 },
              { label: 'Adm. / code', width: 8 },
              { label: 'Class / department', width: 9 },
              { label: 'Contact', width: 12 },
            ],
            rows: r.rows.map((x, i) => [
              i + 1,
              String(x.name),
              String(x.code ?? ''),
              String(x.section ?? ''),
              String(x.contact ?? ''),
            ]),
            filename: `${f.code}-pending`,
          },
          q.format,
        );
      }
      const r = await this.answeredRows(c, f, q, true);
      const hasFee = (f.settings.fee?.mode ?? 'none') !== 'none';
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: f.title,
          details: [`${r.total} response${r.total === 1 ? '' : 's'}`, generatedOn()],
          legend: 'One row per response; one column per question.',
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'Number', width: 9 },
            { label: 'Name', width: 12 },
            { label: 'Adm. / code', width: 6 },
            { label: 'Class', width: 5 },
            { label: 'Answered by', width: 9 },
            { label: 'On', width: 8 },
            { label: 'Status', width: 6 },
            ...(hasFee
              ? [
                  { label: 'Fee', width: 5, right: true },
                  { label: 'Paid', width: 5, right: true },
                ]
              : []),
            ...fields.map((x) => ({ label: x.label.slice(0, 60), width: 8 })),
          ],
          rows: r.rows.map((x, i) => [
            i + 1,
            String(x.number ?? ''),
            String(x.student ?? x.employee ?? x.publicName ?? ''),
            String(x.admissionNo ?? x.employeeCode ?? x.publicMobile ?? x.publicEmail ?? ''),
            String(x.section ?? ''),
            `${String(x.byUser ?? x.signedName ?? '')}${x.respondent === 'office' ? ' (office)' : ''}`,
            new Date(x.signedAt as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            x.waitingWith
              ? 'Waiting'
              : x.status === 'submitted'
                ? 'Answered'
                : String(x.status).replace(/^./, (ch) => ch.toUpperCase()),
            ...(hasFee ? [Number(x.fee ?? 0).toFixed(2), Number(x.paid ?? 0).toFixed(2)] : []),
            ...fields.map((fl) => answerText(fl, (x.answers as Answers)[fl.key])),
          ]),
          fontSize: fields.length > 6 ? 6.5 : undefined,
          filename: f.code,
        },
        q.format,
      );
    });
  }

  /**
   * The form at a glance: answers per day, the response rate by section, who answered (family, staff,
   * office, public link), approval, the fee raised and paid, and each question's answers counted.
   */
  async analytics(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const f = await this.findDb(c, id);
      const pupils = await this.audienceStudents(c, f);
      const staff = await this.audienceStaff(c, f);
      const daily = await c.query<{ day: string; n: number }>(
        `SELECT (signed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, count(*)::int AS n
           FROM consent_form_responses WHERE form_id = $1 AND status <> 'withdrawn' GROUP BY 1 ORDER BY 1`,
        [id],
      );
      const bySection = await c.query<{ section: string; asked: number; answered: number }>(
        `SELECT k.name || '-' || cs.name AS section, count(*)::int AS asked,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM consent_form_responses x WHERE x.form_id = $3 AND x.student_id = e.student_id AND x.status <> 'withdrawn'))::int AS answered
           FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.student_id = ANY($1::bigint[]) AND e.academic_year_id = $2 AND e.status = 'active'
          GROUP BY k.display_order, k.name, cs.name ORDER BY k.display_order, cs.name`,
        [pupils, f.year_id, id],
      );
      const rows = await c.query<{
        respondent: string;
        via_link: boolean;
        status: string;
        waiting: boolean;
        answers: Answers;
        employee_id: string | null;
      }>(
        `SELECT x.respondent, x.via_link, x.status, x.answers, x.employee_id::text,
                EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending') AS waiting
           FROM consent_form_responses x WHERE x.form_id = $1 AND x.status <> 'withdrawn'`,
        [id],
      );
      const staffAnswered = new Set(rows.rows.map((r) => r.employee_id).filter(Boolean)).size;
      const by = (fn: (r: (typeof rows.rows)[number]) => boolean) => rows.rows.filter(fn).length;
      const fee = f.misc_fee_id
        ? (
            await c.query<{ raised: string; paid: string; pupils: number }>(
              `SELECT COALESCE(sum(amount), 0)::text AS raised, COALESCE(sum(paid), 0)::text AS paid, count(*) FILTER (WHERE amount > 0)::int AS pupils
                 FROM misc_fee_students WHERE misc_fee_id = $1 AND status <> 'cancelled'`,
              [f.misc_fee_id],
            )
          ).rows[0]!
        : null;
      const lists = await sourceOptions(c, f.fields);
      const questions = f.fields
        .filter((q) => !LAYOUT.includes(q.type))
        .map((q) => {
          const given = rows.rows
            .map((r) => r.answers[q.key])
            .filter((v) => v !== undefined && v !== null && v !== '');
          if (['radio', 'select', 'checkbox', 'yesno', 'agree'].includes(q.type)) {
            const options =
              q.type === 'yesno'
                ? ['Yes', 'No']
                : q.type === 'agree'
                  ? ['Agreed']
                  : q.source
                    ? (lists[q.source] ?? [])
                    : (q.options ?? []);
            const counts = new Map(options.map((o) => [o, 0]));
            for (const v of given) {
              const picked = Array.isArray(v)
                ? v
                : [
                    q.type === 'yesno'
                      ? v === true
                        ? 'Yes'
                        : 'No'
                      : q.type === 'agree'
                        ? 'Agreed'
                        : String(v),
                  ];
              for (const p of picked) counts.set(p, (counts.get(p) ?? 0) + 1);
            }
            return {
              key: q.key,
              label: q.label,
              type: q.type,
              answered: given.length,
              counts: [...counts.entries()].map(([option, n]) => ({ option, n })),
            };
          }
          if (q.type === 'number') {
            const nums = given.map(Number).filter((n) => Number.isFinite(n));
            return {
              key: q.key,
              label: q.label,
              type: q.type,
              answered: nums.length,
              stats: nums.length
                ? {
                    total: nums.reduce((a, b) => a + b, 0),
                    avg: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100,
                    min: Math.min(...nums),
                    max: Math.max(...nums),
                  }
                : null,
            };
          }
          return { key: q.key, label: q.label, type: q.type, answered: given.length };
        });
      return {
        asked: pupils.length + staff.length,
        answeredPupils: bySection.rows.reduce((a, b) => a + b.answered, 0),
        answeredStaff: staffAnswered,
        responses: rows.rows.length,
        daily: daily.rows,
        bySection: bySection.rows,
        byRespondent: {
          family: by((r) => r.respondent === 'family' && !r.via_link),
          familyLink: by((r) => r.respondent === 'family' && r.via_link),
          staff: by((r) => r.respondent === 'staff'),
          office: by((r) => r.respondent === 'office'),
          public: by((r) => r.respondent === 'public'),
        },
        approval: f.settings.approval?.on
          ? {
              waiting: by((r) => r.waiting),
              approved: by((r) => r.status === 'approved'),
              rejected: by((r) => r.status === 'rejected'),
            }
          : null,
        fee: fee
          ? { raised: Number(fee.raised), paid: Number(fee.paid), pupils: fee.pupils }
          : null,
        questions,
      };
    });
  }

  // ---- one response -----------------------------------------------------------------------------
  private async responseDb(c: PoolClient, rid: string) {
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed fragment over a column name
      `SELECT x.id::text, x.form_id::text AS "formId", x.number, x.respondent, x.status, x.answers, x.files, x.signed_name AS "signedName",
              x.signed_at AS "signedAt", x.student_id::text AS "studentId", s.display_name AS student, s.admission_no AS "admissionNo",
              (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = x.student_id AND e.status = 'active' ORDER BY e.academic_year_id DESC LIMIT 1) AS section,
              x.employee_id::text AS "employeeId", em.display_name AS employee, em.employee_code AS "employeeCode",
              (SELECT display_name FROM users WHERE id = x.signed_by) AS "byUser",
              (SELECT display_name FROM users WHERE id = x.entered_by) AS "enteredBy",
              (SELECT array_agg(field_key) FROM consent_form_signatures sg WHERE sg.response_id = x.id) AS signed,
              x.fee_amount::text AS fee, x.misc_line_id::text AS "lineId", l.paid::text AS paid, l.status AS "lineStatus",
              x.instance_id::text AS "instanceId", x.decided_at AS "decidedAt", x.decided_note AS "decidedNote",
              x.edited_at AS "editedAt", x.edits, ${WAITING_WITH('x.instance_id')} AS "waitingWith",
              x.via_link AS "viaLink", x.public_name AS "publicName", x.public_mobile AS "publicMobile", x.public_email AS "publicEmail"
         FROM consent_form_responses x LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees em ON em.id = x.employee_id
         LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id
        WHERE x.id = $1`,
      [rid],
    );
    const row = r.rows[0];
    if (!row) throw new DomainError('not-found', 'Response not found', { status: 404 });
    return row;
  }

  async response(ctx: RequestContext, id: string, rid: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const row = await this.responseDb(c, rid);
      if (row.formId !== id)
        throw new DomainError('not-found', 'Response not found', { status: 404 });
      // the earlier versions of a changed answer, newest first
      const versions = await c.query<Row>(
        `SELECT v.id::text, v.answers, v.signed_name AS "signedName", v.fee_amount::text AS fee, v.written_at AS "writtenAt",
                v.replaced_at AS "replacedAt", (SELECT display_name FROM users WHERE id = v.replaced_by) AS "replacedBy"
           FROM consent_form_response_versions v WHERE v.response_id = $1 ORDER BY v.replaced_at DESC`,
        [rid],
      );
      return { ...row, versions: versions.rows };
    });
  }

  /** A drawn signature, as a PNG (base64), for the office. */
  async signature(ctx: RequestContext, id: string, rid: string, key: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const r = await c.query<{ png: Buffer }>(
        `SELECT g.png FROM consent_form_signatures g JOIN consent_form_responses x ON x.id = g.response_id
          WHERE g.response_id = $1 AND g.field_key = $2 AND x.form_id = $3`,
        [rid, key, id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'No signature', { status: 404 });
      return { contentType: 'image/png', base64: r.rows[0].png.toString('base64') };
    });
  }

  /** The PDF copy of a response: the form, the answers, the signature, who answered and when. */
  async pdfOf(c: PoolClient, rid: string) {
    const row = await this.responseDb(c, rid);
    const f = await this.findDb(c, String(row.formId));
    const head = await schoolHead(c);
    const sig = await c.query<{ field_key: string; png: Buffer }>(
      `SELECT field_key, png FROM consent_form_signatures WHERE response_id = $1`,
      [rid],
    );
    const answers = row.answers as Answers;
    const bytes = await consentPdf({
      school: head.name,
      address: head.address,
      title: f.title,
      description: f.description,
      number: String(row.number ?? ''),
      about: row.student
        ? `${String(row.student)} (${String(row.admissionNo)}${row.section ? `, ${String(row.section)}` : ''})`
        : row.employee
          ? `${String(row.employee)} (${String(row.employeeCode ?? '')})`
          : `${String(row.publicName ?? '')} (${String(row.publicMobile ?? row.publicEmail ?? '')})`,
      answeredBy: `${String(row.byUser ?? row.signedName ?? row.publicName ?? '')}${row.respondent === 'office' ? ', entered by the school office' : row.viaLink ? ', on the public link' : ''}`,
      signedName: (row.signedName as string | null) ?? null,
      on: new Date(row.signedAt as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      items: f.fields
        .filter((x) => x.type !== 'pagebreak')
        .filter((x) => x.type === 'heading' || answers[x.key] !== undefined)
        .map((x) =>
          x.type === 'heading'
            ? { heading: x.label }
            : {
                label: x.label,
                value: answerText(x, answers[x.key]),
                signature: sig.rows.find((s) => s.field_key === x.key)?.png ?? null,
              },
        ),
    });
    return {
      filename: `${String(row.number ?? 'response').replace(/\//g, '-')}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  async responsePdf(ctx: RequestContext, id: string, rid: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, id, 'viewer');
      const row = await this.responseDb(c, rid);
      if (row.formId !== id)
        throw new DomainError('not-found', 'Response not found', { status: 404 });
      return this.pdfOf(c, rid);
    });
  }

  // ---- answering --------------------------------------------------------------------------------
  /** The files of an answer, uploaded and ready; on the public link only those uploaded for this form. */
  private async fileRows(c: PoolClient, fileIds: string[], linkFormId: string | null = null) {
    const files: Array<{ fileId: string; name: string | null }> = [];
    for (const fileId of fileIds) {
      const r = await c.query<{ status: string; original_name: string | null }>(
        `SELECT status, original_name FROM files WHERE id = $1
            AND ($2::text IS NULL OR (owner_entity_type = 'consent_form' AND owner_entity_id = $2::text))`,
        [fileId, linkFormId],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
      if (r.rows[0].status !== 'ready')
        throw new DomainError('file.not_ready', 'A file is still uploading', { status: 409 });
      files.push({ fileId, name: r.rows[0].original_name });
    }
    return files;
  }

  /**
   * Writes a response after every check: the form open, the person asked, once only when the form says
   * so, the answers against the fields and rules, the files ready; a drawn signature is kept beside it.
   */
  async write(
    c: PoolClient,
    ctx: RequestContext,
    formId: string,
    who: {
      studentId?: string;
      employeeId?: string;
      respondent: 'family' | 'staff' | 'office' | 'public';
      /** answered on the public link: a family without the app, or an outsider */
      link?: { name?: string; mobile?: string; email?: string };
    },
    dto: Pick<ConsentRespondDto, 'answers' | 'signedName'>,
  ) {
    const f = await this.findDb(c, formId, true);
    const state = this.openState(f);
    if (!state.open)
      throw new DomainError('consent.not_open', `The form is ${state.why ?? 'not open'}`, {
        status: 409,
      });
    if (who.respondent === 'public') {
      if (!f.settings.publicLink?.on || !f.settings.publicLink.outsiders)
        throw new DomainError('consent.not_asked', 'This form is not open to the public', {
          status: 403,
        });
    } else if (who.studentId) {
      if (!(await this.audienceStudents(c, f)).includes(who.studentId))
        throw new DomainError('consent.not_asked', 'This form is not for this pupil', {
          status: 403,
        });
    } else if (who.employeeId) {
      if (!(await this.audienceStaff(c, f)).includes(who.employeeId))
        throw new DomainError('consent.not_asked', 'This form is not for this staff member', {
          status: 403,
        });
    }
    if (f.settings.repeat !== 'many') {
      const dup = await c.query(
        `SELECT 1 FROM consent_form_responses WHERE form_id = $1 AND status <> 'withdrawn'
            AND (student_id = $2::bigint OR employee_id = $3::bigint
                 OR (respondent = 'public' AND (public_mobile = $4 OR public_email = $5)))`,
        [
          formId,
          who.studentId ?? null,
          who.employeeId ?? null,
          who.respondent === 'public' ? (who.link?.mobile ?? null) : null,
          who.respondent === 'public' ? (who.link?.email ?? null) : null,
        ],
      );
      if (dup.rowCount)
        throw new DomainError('consent.already', 'This form is already answered', {
          status: 409,
        });
    }
    const lists = await sourceOptions(c, f.fields);
    const { answers, fileIds, signatures } = checkAnswers(f.fields, dto.answers, lists);
    const files = await this.fileRows(c, fileIds, who.link ? formId : null);
    // a fee only on an answer about a pupil
    const fee = who.studentId
      ? feeOf(f.settings.fee ?? { mode: 'none', items: [] }, f.fields, answers)
      : 0;
    const number = (
      await c.query<{ n: string }>(`SELECT app.next_consent_no($1) AS n`, [f.year_id])
    ).rows[0]!.n;
    const r = await c.query<{ id: string }>(
      `INSERT INTO consent_form_responses (school_id, form_id, student_id, employee_id, answers, files, signed_by, signed_name, number, respondent, entered_by, request_id, fee_amount,
                                          via_link, public_name, public_mobile, public_email)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::jsonb, app.current_user_id(), $6, $7, $8,
               CASE WHEN $8 = 'office' THEN app.current_user_id() END, app.current_request_id(), $9, $10, $11, $12, $13)
       RETURNING id::text`,
      [
        formId,
        who.studentId ?? null,
        who.employeeId ?? null,
        JSON.stringify(answers),
        JSON.stringify(files),
        dto.signedName ?? null,
        number,
        who.respondent,
        fee.toFixed(2),
        Boolean(who.link),
        who.link?.name ?? null,
        who.link?.mobile ?? null,
        who.link?.email ?? null,
      ],
    );
    const rid = r.rows[0]!.id;
    for (const [key, png] of Object.entries(signatures))
      await c.query(
        `INSERT INTO consent_form_signatures (response_id, school_id, field_key, png) VALUES ($1, app.current_school_id(), $2, $3)`,
        [rid, key, png],
      );
    // approval first (levels set on the form; the fee waits for it), else the fee at once
    let waiting = false;
    // staff and outsiders: the levels without the class teacher
    const staff = !who.studentId;
    if (needsApproval(f.settings.approval, staff)) {
      await syncFlows(c, { id: f.id, title: f.title, approval: f.settings.approval });
      const about = await c.query<{ name: string; section_id: string | null }>(
        who.studentId
          ? `SELECT s.display_name AS name, (SELECT e.class_section_id::text FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS section_id
               FROM students s WHERE s.id = $1`
          : `SELECT COALESCE((SELECT display_name FROM employees WHERE id = $1), $3) AS name, NULL AS section_id WHERE $2::bigint IS NOT NULL`,
        who.studentId
          ? [who.studentId, f.year_id]
          : [who.employeeId ?? null, f.year_id, who.link?.name ?? 'Public link'],
      );
      const inst = await this.workflow.start(c, ctx, {
        definitionCode: flowCode(f.id, staff),
        entityType: ENTITY,
        entityId: rid,
        subject: `${f.title}: ${about.rows[0]?.name ?? ''} (${number})`.slice(0, 240),
        payload: { sectionId: about.rows[0]?.section_id ?? null, formId: f.id, number },
      });
      await c.query(`UPDATE consent_form_responses SET instance_id = $2 WHERE id = $1`, [
        rid,
        inst.id,
      ]);
      waiting = true;
    } else
      await raiseFee(
        c,
        { ...f, fee: f.settings.fee, closesAt: f.settings.closesAt },
        { id: rid, studentId: who.studentId ?? null, amount: fee },
      );
    await emitConsentEvent(c, rid, 'submitted');
    // the cap reached closes the form
    if (f.settings.cap && f.responses + 1 >= f.settings.cap)
      await c.query(
        `UPDATE consent_forms SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'published'`,
        [formId],
      );
    await this.audit.stage(ctx, c, {
      action: 'engagement.consent_form.respond',
      entityType: 'consent_form_responses',
      entityId: rid,
      after: {
        formId,
        number,
        respondent: who.respondent,
        studentId: who.studentId ?? null,
        employeeId: who.employeeId ?? null,
        fee,
        waiting,
      },
    });
    return {
      id: rid,
      number,
      success: f.settings.success ?? null,
      title: f.title,
      fee,
      waiting,
    };
  }

  /**
   * The last level decided (workflow onComplete): approved raises the fee; either way the family or
   * staff member is told in the app with the approver's note.
   */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    const r = await c.query<{
      id: string;
      form_id: string;
      student_id: string | null;
      fee_amount: string;
      number: string;
      signed_by: string | null;
      public_mobile: string | null;
      public_email: string | null;
    }>(
      `SELECT id::text, form_id::text, student_id::text, fee_amount::text, number, signed_by::text, public_mobile, public_email
         FROM consent_form_responses WHERE id = $1 FOR UPDATE`,
      [instance.entityId],
    );
    const row = r.rows[0];
    if (!row) return;
    const note = (
      await c.query<{ note: string | null }>(
        `SELECT note FROM workflow_steps WHERE instance_id = $1 AND acted_at IS NOT NULL ORDER BY acted_at DESC LIMIT 1`,
        [instance.id],
      )
    ).rows[0]?.note;
    await c.query(
      `UPDATE consent_form_responses SET status = $2, decided_at = now(), decided_note = $3, updated_at = now() WHERE id = $1`,
      [row.id, outcome, note ?? null],
    );
    const f = await this.findDb(c, row.form_id);
    await emitConsentEvent(c, row.id, outcome);
    if (outcome === 'approved')
      await raiseFee(
        c,
        { ...f, fee: f.settings.fee, closesAt: f.settings.closesAt },
        { id: row.id, studentId: row.student_id, amount: Number(row.fee_amount) },
      );
    if (!row.signed_by) {
      // answered on the public link: told by SMS / WhatsApp / email with the school's templates
      await c.query(`SELECT app.consent_seed_templates(app.current_school_id())`);
      const vars = JSON.stringify({
        form: f.title,
        number: row.number,
        decision: outcome === 'approved' ? 'approved' : 'not approved',
        note: [
          note ?? '',
          outcome === 'approved' && Number(row.fee_amount) > 0
            ? `Fee Rs ${row.fee_amount} to pay on the form's link.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        school:
          (
            await c.query<{ name: string }>(
              `SELECT name FROM schools WHERE id = app.current_school_id()`,
            )
          ).rows[0]?.name ?? '',
      });
      // an outsider's own mobile, or the family mobiles of the pupil
      const mobiles = row.public_mobile
        ? [row.public_mobile]
        : row.student_id
          ? (
              await c.query<{ mobile: string }>(
                `SELECT DISTINCT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = $1 AND g.deleted_at IS NULL AND g.mobile IS NOT NULL AND g.mobile <> '' LIMIT 2`,
                [row.student_id],
              )
            ).rows.map((x) => x.mobile)
          : [];
      for (const mobile of mobiles)
        for (const ch of ['sms', 'whatsapp'])
          await c.query(`SELECT app.send_template('consent_decision', $1, $2, $3::jsonb)`, [
            ch,
            mobile,
            vars,
          ]);
      // emails: the outsider's own, or the family's on file
      const linkMails = row.public_email
        ? [row.public_email]
        : row.student_id
          ? (
              await c.query<{ email: string }>(
                `SELECT DISTINCT lower(g.email) AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = $1 AND g.deleted_at IS NULL AND g.email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' LIMIT 2`,
                [row.student_id],
              )
            ).rows.map((x) => x.email)
          : [];
      for (const m of linkMails)
        await c.query(`SELECT app.send_template('consent_decision', 'email', $1, $2::jsonb)`, [
          m,
          vars,
        ]);
      return;
    }
    // the family (or staff member) also gets the decision as a letter by email
    await c.query(`SELECT app.consent_seed_templates(app.current_school_id())`);
    const mails = await c.query<{ email: string }>(
      `SELECT DISTINCT lower(g.email) AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.deleted_at IS NULL AND g.email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
       UNION SELECT lower(u.email) FROM users u WHERE u.id = $2 AND $1::bigint IS NULL AND u.email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
      [row.student_id, row.signed_by],
    );
    const school = (
      await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = app.current_school_id()`)
    ).rows[0]?.name;
    for (const m of mails.rows.slice(0, 3))
      await c.query(`SELECT app.send_template('consent_decision', 'email', $1, $2::jsonb)`, [
        m.email,
        JSON.stringify({
          form: f.title,
          number: row.number,
          decision: outcome === 'approved' ? 'approved' : 'not approved',
          note: note ?? '',
          school: school ?? '',
        }),
      ]);
    await this.push.send(c, ctx, {
      userIds: [row.signed_by],
      title: outcome === 'approved' ? 'Your answer is approved' : 'Your answer is not approved',
      body: `${f.title} · ${row.number}${note ? ` · ${note}` : ''}${outcome === 'approved' && Number(row.fee_amount) > 0 ? ` · Fee ₹${row.fee_amount} to pay` : ''}`.slice(
        0,
        240,
      ),
      link: '/consents',
      event: 'approvals',
    });
  }

  /**
   * A family or staff member changes an answer: until the form's edit date, while the form is open and
   * the answer not yet decided. The earlier version is kept; a signature or files may be kept as they
   * were; a different fee is refused once something is paid on the pupil's line.
   */
  async editMine(ctx: RequestContext, rid: string, dto: ConsentEditDto) {
    const me = await this.whoAmI(ctx);
    return this.editAs(ctx, rid, dto, (row) =>
      Boolean(
        (row.student_id && me.children.some((s) => s.id === row.student_id)) ||
        (row.employee_id && row.employee_id === me.employeeId),
      ),
    );
  }

  /** Changes an answer the caller owns (see editMine; the public link checks its own token). */
  async editAs(
    ctx: RequestContext,
    rid: string,
    dto: ConsentEditDto,
    owns: (row: {
      student_id: string | null;
      employee_id: string | null;
      form_id: string;
      public_mobile: string | null;
      public_email: string | null;
      respondent: string;
    }) => boolean,
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        form_id: string;
        student_id: string | null;
        employee_id: string | null;
        status: string;
        answers: Answers;
        files: Array<{ fileId: string; name: string | null }>;
        signed_name: string | null;
        fee_amount: string;
        misc_line_id: string | null;
        written_by: string;
        written_at: Date;
        number: string;
        public_mobile: string | null;
        public_email: string | null;
        respondent: string;
        via_link: boolean;
      }>(
        `SELECT id::text, form_id::text, student_id::text, employee_id::text, status, answers, files, signed_name, fee_amount::text,
                public_mobile, public_email, respondent, via_link,
                misc_line_id::text, number, COALESCE((SELECT replaced_by FROM consent_form_response_versions v WHERE v.response_id = x.id ORDER BY v.replaced_at DESC LIMIT 1), signed_by)::text AS written_by,
                COALESCE(edited_at, signed_at) AS written_at
           FROM consent_form_responses x WHERE id = $1 FOR UPDATE`,
        [rid],
      );
      const row = r.rows[0];
      if (!row || !owns(row))
        throw new DomainError('not-found', 'Response not found', { status: 404 });
      const f = await this.findDb(c, row.form_id);
      if (row.status !== 'submitted')
        throw new DomainError('consent.decided', 'The answer is already decided: ask the school', {
          status: 409,
        });
      if (!f.settings.editUntil || nowLocal() > f.settings.editUntil || f.status !== 'published')
        throw new DomainError(
          'consent.edit_closed',
          'Answers to this form can no longer be changed',
          {
            status: 409,
          },
        );
      const signedBefore = await c.query<{ field_key: string }>(
        `SELECT field_key FROM consent_form_signatures WHERE response_id = $1`,
        [rid],
      );
      const filesBefore: Record<string, string[]> = {};
      for (const fl of f.fields)
        if (fl.type === 'file' && Array.isArray(row.answers[fl.key]))
          filesBefore[fl.key] = row.answers[fl.key] as string[];
      const lists = await sourceOptions(c, f.fields);
      const { answers, fileIds, signatures, kept } = checkAnswers(f.fields, dto.answers, lists, {
        signed: new Set(signedBefore.rows.map((x) => x.field_key)),
        files: filesBefore,
      });
      const files = await this.fileRows(c, fileIds, row.via_link ? row.form_id : null);
      const fee = row.student_id
        ? feeOf(f.settings.fee ?? { mode: 'none', items: [] }, f.fields, answers)
        : 0;
      await refeeAllowed(c, row.misc_line_id, Number(row.fee_amount), fee);
      await c.query(
        `INSERT INTO consent_form_response_versions (school_id, response_id, answers, files, signed_name, fee_amount, written_by, written_at, replaced_by)
         VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, app.current_user_id())`,
        [
          rid,
          JSON.stringify(row.answers),
          JSON.stringify(row.files),
          row.signed_name,
          row.fee_amount,
          row.written_by,
          row.written_at,
        ],
      );
      await c.query(
        `UPDATE consent_form_responses SET answers = $2::jsonb, files = $3::jsonb, signed_name = COALESCE($4, signed_name), fee_amount = $5,
                edited_at = now(), edits = edits + 1, updated_at = now() WHERE id = $1`,
        [
          rid,
          JSON.stringify(answers),
          JSON.stringify(files),
          dto.signedName ?? null,
          fee.toFixed(2),
        ],
      );
      await c.query(
        `DELETE FROM consent_form_signatures WHERE response_id = $1 AND field_key <> ALL($2::text[])`,
        [rid, kept],
      );
      for (const [key, png] of Object.entries(signatures))
        await c.query(
          `INSERT INTO consent_form_signatures (response_id, school_id, field_key, png) VALUES ($1, app.current_school_id(), $2, $3)
           ON CONFLICT (response_id, field_key) DO UPDATE SET png = EXCLUDED.png, created_at = now()`,
          [rid, key, png],
        );
      if (row.misc_line_id) await syncLine(c, row.misc_line_id);
      await emitConsentEvent(c, rid, 'changed');
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.edit',
        entityType: 'consent_form_responses',
        entityId: rid,
        before: { fee: Number(row.fee_amount) },
        after: { fee },
      });
      return { id: rid, number: row.number, fee };
    });
  }

  /** Answers waiting for my decision (I am an approver of the current level). */
  async myApprovals(ctx: RequestContext) {
    const items = (await this.workflow.inbox(ctx)).filter((i) => i.instance.entityType === ENTITY);
    if (!items.length) return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const forms = new Map<string, FormDb>();
      const data = [];
      for (const it of items) {
        const row = await this.responseDb(c, it.instance.entityId).catch(() => null);
        if (!row) continue;
        const fid = String(row.formId);
        if (!forms.has(fid)) forms.set(fid, await this.findDb(c, fid));
        const f = forms.get(fid)!;
        const answers = row.answers as Answers;
        data.push({
          stepId: it.id,
          level: it.name,
          formId: fid,
          form: f.title,
          responseId: row.id,
          number: row.number,
          about: row.student ?? row.employee,
          admissionNo: row.admissionNo ?? row.employeeCode,
          section: row.section,
          byUser: row.byUser ?? row.signedName,
          signedAt: row.signedAt,
          fee: row.fee,
          answers: f.fields
            .filter((x) => !LAYOUT.includes(x.type) && answers[x.key] !== undefined)
            .map((x) => ({ label: x.label, value: answerText(x, answers[x.key]) })),
        });
      }
      return { data };
    });
  }

  /** Approve or reject an answer at my level (the last level completes it: fee, family told). */
  async decide(ctx: RequestContext, stepId: string, dto: ConsentDecideDto) {
    const ok = await this.db.tenant(requireTenant(ctx), async (c) =>
      c.query(
        `SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id WHERE s.id = $1 AND i.entity_type = $2`,
        [stepId, ENTITY],
      ),
    );
    if (!ok.rowCount) throw new DomainError('not-found', 'Step not found', { status: 404 });
    const inst = await this.workflow.act(ctx, stepId, dto.decision, { note: dto.note });
    return { status: inst.status, currentLevel: inst.currentLevel };
  }

  /** The office fills on behalf of a family (a pupil) or a staff member. */
  async fillForOffice(ctx: RequestContext, formId: string, dto: ConsentRespondDto) {
    if (Boolean(dto.studentId) === Boolean(dto.employeeId))
      throw new DomainError('validation-failed', 'Choose the pupil or the staff member', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.need(c, ctx, formId, 'editor');
      const f = await this.findDb(c, formId);
      if (f.settings.officeFill === false)
        throw new DomainError(
          'consent.no_office',
          'This form is answered only by the family or staff',
          {
            status: 409,
          },
        );
      return this.write(
        c,
        ctx,
        formId,
        { studentId: dto.studentId, employeeId: dto.employeeId, respondent: 'office' },
        dto,
      );
    });
  }

  /** Who the signed-in user answers as: their children (family) and / or themself (staff). */
  private async whoAmI(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    let children: Array<{ id: string; name: string; section: string | null }> = [];
    try {
      const v = await this.viewer.resolve(ctx, CONSENT.familyView);
      if (v.kind === 'family')
        children = v.students.map((s) => ({ id: s.id, name: s.name, section: s.section ?? null }));
    } catch {
      children = [];
    }
    const employeeId = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
      );
      return r.rows[0]?.id ?? null;
    });
    return { children, employeeId };
  }

  /** The forms for me: per child (family) and for myself (staff), open ones and those I answered. */
  async mine(ctx: RequestContext) {
    const me = await this.whoAmI(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<FormDb>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${FORM} WHERE f.deleted_at IS NULL AND f.status IN ('published', 'closed') ORDER BY f.published_at DESC NULLS LAST LIMIT 100`,
      );
      const out = [];
      for (const f of r.rows) {
        f.audience = { ...AUDIENCE_DEFAULT, ...f.audience };
        const pupils = me.children.length ? new Set(await this.audienceStudents(c, f)) : new Set();
        const asStaff =
          me.employeeId !== null && (await this.audienceStaff(c, f)).includes(me.employeeId);
        const people = [
          ...me.children
            .filter((s) => pupils.has(s.id))
            .map((s) => ({ kind: 'student' as const, id: s.id, name: s.name })),
          ...(asStaff ? [{ kind: 'staff' as const, id: me.employeeId!, name: 'Myself' }] : []),
        ];
        if (!people.length) continue;
        const state = this.openState(f);
        const editable =
          f.status === 'published' &&
          Boolean(f.settings.editUntil) &&
          nowLocal() <= (f.settings.editUntil ?? '');
        const answers = await c.query<Row>(
          `SELECT x.id::text, x.number, x.student_id::text AS "studentId", x.employee_id::text AS "employeeId", x.signed_at AS "signedAt",
                  x.respondent, x.status, x.fee_amount::text AS fee, x.misc_line_id::text AS "lineId", l.paid::text AS paid, l.amount::text AS "lineAmount",
                  x.decided_note AS "decidedNote",
                  EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = x.instance_id AND wi.status = 'pending') AS waiting,
                  (x.status = 'submitted' AND $4::boolean) AS "canEdit"
             FROM consent_form_responses x LEFT JOIN misc_fee_students l ON l.id = x.misc_line_id
            WHERE x.form_id = $1 AND x.status <> 'withdrawn'
              AND (x.student_id = ANY($2::bigint[]) OR x.employee_id = $3::bigint) ORDER BY x.signed_at DESC`,
          [
            f.id,
            people.filter((p) => p.kind === 'student').map((p) => p.id),
            me.employeeId,
            editable,
          ],
        );
        const rows = people.map((p) => {
          const mine = answers.rows.filter((a) =>
            p.kind === 'student' ? a.studentId === p.id : a.employeeId === p.id,
          );
          return {
            ...p,
            responses: mine,
            canAnswer: state.open && (f.settings.repeat === 'many' || mine.length === 0),
          };
        });
        // a closed form is listed only to show what was answered
        if (!state.open && !rows.some((x) => x.responses.length)) continue;
        out.push({
          id: f.id,
          title: f.title,
          description: f.description,
          open: state.open,
          closedWhy: state.why,
          closesAt: f.settings.closesAt ?? null,
          editUntil: f.settings.editUntil ?? null,
          repeat: f.settings.repeat,
          feeMode: f.settings.fee?.mode ?? 'none',
          approval: Boolean(f.settings.approval?.on),
          people: rows,
        });
      }
      return { forms: out, children: me.children, staff: me.employeeId !== null };
    });
  }

  /** One form to fill, for a child or for myself. */
  async mineForm(ctx: RequestContext, id: string, studentId?: string, responseId?: string) {
    const me = await this.whoAmI(ctx);
    if (studentId && !me.children.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    if (!studentId && !me.employeeId)
      throw new DomainError('not-found', 'Form not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.findDb(c, id);
      const asked = studentId
        ? (await this.audienceStudents(c, f)).includes(studentId)
        : (await this.audienceStaff(c, f)).includes(me.employeeId!);
      if (!asked || f.status === 'draft' || f.status === 'archived')
        throw new DomainError('not-found', 'Form not found', { status: 404 });
      const state = this.openState(f);
      const done = await c.query<Row>(
        `SELECT id::text, number, signed_at AS "signedAt" FROM consent_form_responses
          WHERE form_id = $1 AND status <> 'withdrawn' AND (student_id = $2::bigint OR employee_id = $3::bigint) ORDER BY signed_at DESC`,
        [id, studentId ?? null, studentId ? null : me.employeeId],
      );
      // changing an answer: what was answered, which signatures and files are on it
      let editing: Row | null = null;
      if (responseId) {
        const e = await c.query<Row>(
          `SELECT x.id::text, x.number, x.answers, x.signed_name AS "signedName", x.status,
                  (SELECT array_agg(field_key) FROM consent_form_signatures sg WHERE sg.response_id = x.id) AS signed
             FROM consent_form_responses x WHERE x.id = $1 AND x.form_id = $2 AND (x.student_id = $3::bigint OR x.employee_id = $4::bigint)`,
          [responseId, id, studentId ?? null, studentId ? null : me.employeeId],
        );
        editing = e.rows[0] ?? null;
        if (!editing) throw new DomainError('not-found', 'Response not found', { status: 404 });
      }
      const canEdit =
        editing !== null &&
        editing.status === 'submitted' &&
        f.status === 'published' &&
        Boolean(f.settings.editUntil) &&
        nowLocal() <= (f.settings.editUntil ?? '');
      return {
        id: f.id,
        title: f.title,
        description: f.description,
        fields: f.fields,
        lists: await sourceOptions(c, f.fields),
        fee: f.settings.fee ?? { mode: 'none', items: [] },
        approval: Boolean(f.settings.approval?.on),
        editUntil: f.settings.editUntil ?? null,
        editing,
        canEdit,
        open: state.open,
        closedWhy: state.why,
        closesAt: f.settings.closesAt ?? null,
        repeat: f.settings.repeat,
        about: studentId
          ? (me.children.find((s) => s.id === studentId) ?? null)
          : { id: me.employeeId, name: 'Myself', section: null },
        responses: done.rows,
        canAnswer: state.open && (f.settings.repeat === 'many' || done.rows.length === 0),
      };
    });
  }

  /** A family answers for a child, or a staff member for themself. */
  async respondMine(ctx: RequestContext, formId: string, dto: ConsentRespondDto) {
    const me = await this.whoAmI(ctx);
    if (dto.studentId) {
      if (!me.children.some((s) => s.id === dto.studentId))
        throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    } else if (!me.employeeId)
      throw new DomainError('validation-failed', 'Choose the pupil', { status: 400 });
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.write(
        c,
        ctx,
        formId,
        dto.studentId
          ? { studentId: dto.studentId, respondent: 'family' }
          : { employeeId: me.employeeId!, respondent: 'staff' },
        dto,
      ),
    );
  }

  /** The PDF copy of my own response (a child's or mine). */
  async minePdf(ctx: RequestContext, rid: string) {
    const me = await this.whoAmI(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.responseDb(c, rid);
      const mine =
        (row.studentId && me.children.some((s) => s.id === row.studentId)) ||
        (row.employeeId && row.employeeId === me.employeeId);
      if (!mine) throw new DomainError('not-found', 'Response not found', { status: 404 });
      return this.pdfOf(c, rid);
    });
  }
}
