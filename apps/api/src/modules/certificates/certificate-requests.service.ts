import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { SendMessageDto } from '../comms/comms.dto';
import { MessagesService } from '../comms/messages.service';
import { ReportsService } from '../reports/reports.service';
import type { Resolver } from '../workflow/workflow.dto';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { runChecks, type CertificateCheck } from './certificate-checks';
import { requestSettings } from './certificate-setup.service';
import {
  CERTIFICATE,
  type CreateRequestDto,
  type DecideRequestDto,
  type ListRequestsQueryDto,
  type RequestLevel,
} from './certificates.dto';
import { CertificatesService, type TypeRow } from './certificates.service';

/**
 * Certificate requests (docs/design/87, phase C): a parent asks for a child, a student or a staff member for
 * themselves, in their app — the type, the purpose, the copies, a note. The request runs through the approval levels
 * set on the type (one workflow definition a type, "certificate_request_<code>"; the engine's inbox shows it to each
 * level), then, when the type charges a fee, waits for the fee (a misc fee on the student); the office issues it, and
 * the requester is told in the app and downloads it there.
 */
export const REQUEST_ENTITY = 'certificate_request';

type Stage = 'waiting' | 'fee' | 'ready' | 'issued' | 'rejected' | 'withdrawn';
interface RequestDb {
  id: string;
  type_code: string;
  type_name: string;
  audience: 'STUDENT' | 'STAFF';
  student_id: string | null;
  employee_id: string | null;
  person: string;
  person_no: string;
  class_label: string | null;
  channel: string;
  requested_by: string | null;
  requested_by_id: string | null;
  purpose: string | null;
  copies: number;
  note: string | null;
  status: 'submitted' | 'approved' | 'issued' | 'rejected' | 'withdrawn';
  workflow_instance_id: string | null;
  fee_amount: string | null;
  misc_fee_id: string | null;
  fee_paid: boolean | null;
  fee_waived_reason: string | null;
  certificate_ids: string[];
  checks: CertificateCheck[];
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  issued_at: Date | null;
  created_at: Date;
  waiting_with: string | null;
  mine: boolean;
}

const SELECT = `SELECT r.id::text, t.code AS type_code, t.name AS type_name, t.audience, r.student_id::text, r.employee_id::text,
        COALESCE(s.display_name, e.display_name) AS person, COALESCE(s.admission_no, e.employee_code) AS person_no,
        COALESCE((SELECT c.name || ' – ' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                    JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = en.academic_year_id
                   WHERE en.student_id = r.student_id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1),
                 e.designation) AS class_label,
        r.channel, u.display_name AS requested_by, r.requested_by::text AS requested_by_id, r.purpose, r.copies, r.note,
        r.status, r.workflow_instance_id::text, r.fee_amount::text, r.misc_fee_id::text,
        (SELECT l.status = 'paid' FROM misc_fee_students l WHERE l.misc_fee_id = r.misc_fee_id AND l.student_id = r.student_id LIMIT 1) AS fee_paid,
        r.fee_waived_reason, r.certificate_ids::text[] AS certificate_ids, r.checks, r.decision_note,
        du.display_name AS decided_by, r.decided_at, r.issued_at, r.created_at,
        (SELECT st.name || ' (' || COALESCE((SELECT string_agg(au.display_name, ', ' ORDER BY au.display_name) FROM users au
                                              WHERE au.id = ANY(st.assignee_user_ids)), 'nobody yet') || ')'
           FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
          WHERE i.id = r.workflow_instance_id AND i.status = 'pending') AS waiting_with,
        EXISTS (SELECT 1 FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
                 WHERE i.id = r.workflow_instance_id AND i.status = 'pending' AND app.current_user_id() = ANY(st.assignee_user_ids)) AS mine
   FROM certificate_requests r
   JOIN certificate_types t ON t.id = r.type_id
   LEFT JOIN students s ON s.id = r.student_id
   LEFT JOIN employees e ON e.id = r.employee_id
   LEFT JOIN users u ON u.id = r.requested_by
   LEFT JOIN users du ON du.id = r.decided_by`;

/** Where a request stands for the office. */
function stageOf(
  r: Pick<RequestDb, 'status' | 'misc_fee_id' | 'fee_paid' | 'fee_waived_reason'>,
): Stage {
  if (r.status === 'submitted') return 'waiting';
  if (r.status === 'approved')
    return r.misc_fee_id && !r.fee_paid && !r.fee_waived_reason ? 'fee' : 'ready';
  return r.status;
}

const toRow = (r: RequestDb) => ({
  id: r.id,
  typeCode: r.type_code,
  typeName: r.type_name,
  audience: r.audience,
  studentId: r.student_id,
  employeeId: r.employee_id,
  person: r.person,
  personNo: r.person_no,
  classLabel: r.class_label,
  channel: r.channel,
  requestedBy: r.requested_by,
  purpose: r.purpose,
  copies: r.copies,
  note: r.note,
  status: r.status,
  stage: stageOf(r),
  waitingWith: r.waiting_with,
  waitingWithMe: r.mine,
  fee: r.fee_amount ? Number(r.fee_amount) : null,
  feePaid: !!r.fee_paid,
  feeWaived: r.fee_waived_reason,
  certificateIds: r.certificate_ids,
  checks: Array.isArray(r.checks) ? r.checks : [],
  decisionNote: r.decision_note,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
  issuedAt: r.issued_at ? r.issued_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
  ageDays: Math.floor((Date.now() - r.created_at.getTime()) / 86_400_000),
});
export type RequestRow = ReturnType<typeof toRow>;

/** "Office", "Class teacher" … the name of a level. */
function levelName(l: RequestLevel): string {
  if (l.kind === 'office') return 'Certificate office';
  if (l.kind === 'class_teacher') return 'Class teacher';
  if (l.kind === 'signatory') return 'Principal';
  if (l.kind === 'role') return l.name ?? 'Role';
  return l.name ?? 'Named approver';
}

@Injectable()
export class CertificateRequestsService implements OnModuleInit {
  private readonly log = new Logger('CertificateRequests');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly messages: MessagesService,
    private readonly reports: ReportsService,
    private readonly certificates: CertificatesService,
  ) {}

  onModuleInit(): void {
    this.workflow.onComplete(REQUEST_ENTITY, (c, ctx, instance, outcome) =>
      this.onDecision(c, ctx, instance, outcome),
    );
    // issuing against a request goes through the certificate service (one issue path)
    this.certificates.requestHook = {
      check: (c, requestId, typeId, person) => this.forIssue(c, requestId, typeId, person),
      issued: (c, ctx, requestId, certificateId, number) =>
        this.markIssued(c, ctx, requestId, certificateId, number),
    };
  }

  // ---- who is asking -------------------------------------------------------------------------------------------------
  /** The signed-in user's own people: the children of a parent, the student themself, the employee themself. */
  private async mine(c: PoolClient) {
    const kids = await c.query<{
      id: string;
      name: string;
      admission_no: string;
      self: boolean;
      class_label: string | null;
    }>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no, (s.user_id = app.current_user_id()) AS self,
              (SELECT c.name || ' – ' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                 JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = en.academic_year_id
                WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1) AS class_label
         FROM students s
        WHERE s.deleted_at IS NULL AND s.merged_into_id IS NULL
          AND (s.user_id = app.current_user_id()
               OR EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                           WHERE sg.student_id = s.id AND g.user_id = app.current_user_id() AND g.deleted_at IS NULL))
        ORDER BY s.display_name`,
    );
    const emp = await c.query<{
      id: string;
      name: string;
      code: string;
      designation: string | null;
    }>(
      `SELECT id::text, display_name AS name, employee_code AS code, designation FROM employees
        WHERE user_id = app.current_user_id() AND deleted_at IS NULL ORDER BY (status = 'active') DESC, id LIMIT 1`,
    );
    return {
      students: kids.rows.map((k) => ({
        id: k.id,
        name: k.name,
        admissionNo: k.admission_no,
        classLabel: k.class_label,
        self: k.self,
      })),
      employee: emp.rows[0] ?? null,
    };
  }

  // ---- the approval levels of a type ------------------------------------------------------------------------------------
  private async resolver(c: PoolClient, l: RequestLevel): Promise<Resolver> {
    if (l.kind === 'office')
      return { kind: 'any_of', roleCodes: ['certificate_office', 'school_admin'], userIds: [] };
    if (l.kind === 'class_teacher') return { kind: 'class_teacher' };
    if (l.kind === 'user') return { kind: 'named_user', userId: l.userId };
    if (l.kind === 'signatory') {
      const s = await c.query<{ id: string | null }>(
        `SELECT signatory_employee_id::text AS id FROM certificate_settings`,
      );
      const id = s.rows[0]?.id;
      return id
        ? { kind: 'staff', by: 'employees', employeeIds: [id] }
        : { kind: 'role', roleCode: 'school_admin' };
    }
    const r = await c.query<{ code: string }>(`SELECT code FROM roles WHERE id = $1`, [l.roleId]);
    const code = (r.rows[0]?.code ?? '').toLowerCase();
    return /^[a-z_]{2,40}$/.test(code)
      ? { kind: 'role', roleCode: code }
      : { kind: 'role', roleCode: 'school_admin' };
  }

  /** The type's workflow definition made equal to its request settings (the signatory read afresh). */
  private async syncDefinition(c: PoolClient, type: TypeRow): Promise<string> {
    const s = requestSettings(type.request);
    const code = `certificate_request_${type.code.toLowerCase()}`;
    const levels = [];
    for (const [i, l] of s.levels.entries())
      levels.push({ level: i + 1, name: levelName(l), resolver: await this.resolver(c, l) });
    const upd = await c.query(
      `UPDATE workflow_definitions SET name = $2, levels = $3::jsonb, status = 'active', updated_at = now(), updated_by = app.current_user_id()
        WHERE code = $1 AND deleted_at IS NULL`,
      [code, `Certificate request: ${type.name}`, JSON.stringify(levels)],
    );
    if (!upd.rowCount)
      await c.query(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, '{}', app.current_user_id(), app.current_user_id())`,
        [code, `Certificate request: ${type.name}`, REQUEST_ENTITY, JSON.stringify(levels)],
      );
    return code;
  }

  // ---- messages ----------------------------------------------------------------------------------------------------------
  /** An app message to the requester (push only; a message that cannot go never stops the request). */
  private async tell(
    c: PoolClient,
    ctx: RequestContext,
    userId: string | null,
    code: string,
    vars: Record<string, string>,
  ) {
    if (!userId) return;
    await c.query('SAVEPOINT cert_msg');
    try {
      // the notification opens the certificates page of the requester's app (staff, or the family)
      const staff = await c.query(
        `SELECT 1 FROM employees WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId],
      );
      await this.messages.sendWith(c, ctx, {
        templateCode: code,
        channel: 'push',
        recipientUserId: userId,
        variables: { ...vars, link: staff.rowCount ? '/my-certificates' : '/certificates' },
      } as SendMessageDto);
      await c.query('RELEASE SAVEPOINT cert_msg');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT cert_msg');
      this.log.debug({ code, error: (e as Error).message }, 'certificate request message not sent');
    }
  }

  // ---- asking ------------------------------------------------------------------------------------------------------------
  /** What the signed-in user may ask for, their people, their requests and the certificates issued to them. */
  async myOverview(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const me = await this.mine(c);
      const types = await c.query<{
        code: string;
        name: string;
        audience: 'STUDENT' | 'STAFF';
        request: unknown;
      }>(
        `SELECT code, name, audience, request FROM certificate_types WHERE active ORDER BY sort_order, name`,
      );
      const parentOf = me.students.some((s) => !s.self);
      const student = me.students.some((s) => s.self);
      const open = types.rows
        .map((t) => ({ ...t, s: requestSettings(t.request) }))
        .filter((t) =>
          t.audience === 'STAFF'
            ? !!me.employee && t.s.open.staff
            : (parentOf && t.s.open.parent) || (student && t.s.open.student),
        )
        .map((t) => ({
          code: t.code,
          name: t.name,
          audience: t.audience,
          purposes: t.s.purposes,
          maxCopies: t.s.maxCopies,
          fee: t.s.fee,
          forParents: t.s.open.parent,
          forStudents: t.s.open.student,
          // who decides, in order, in words (16 Nov 2026: the app's list says it)
          decidedBy: t.s.levels.map((l) =>
            l.kind === 'office'
              ? 'the office'
              : l.kind === 'class_teacher'
                ? 'the class teacher'
                : l.kind === 'signatory'
                  ? 'the principal'
                  : (l.name ?? 'the school'),
          ),
        }));
      const ids = me.students.map((s) => s.id);
      const empId = me.employee?.id ?? null;
      const reqs = await c.query<RequestDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE r.student_id = ANY($1::bigint[]) OR r.employee_id = $2 OR r.requested_by = app.current_user_id()
          ORDER BY r.created_at DESC LIMIT 100`,
        [ids, empId],
      );
      const certs = await c.query<{
        id: string;
        type_name: string;
        type_code: string;
        number: string;
        copy_no: number;
        issued_on: string;
        person: string;
        student_id: string | null;
        purpose: string | null;
        revision: number;
        award: string | null;
        legacy_ref: string | null;
      }>(
        `SELECT x.id::text, t.name AS type_name, t.code AS type_code, x.number, x.copy_no, x.issued_on::text,
                COALESCE(s.display_name, e.display_name) AS person, x.student_id::text, x.purpose, x.revision,
                NULLIF(concat_ws(' · ', x.data->'fields'->>'award', x.data->'fields'->>'event', x.data->'fields'->>'position'), '') AS award,
                x.legacy_ref
           FROM certificates x JOIN certificate_types t ON t.id = x.type_id
           LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees e ON e.id = x.employee_id
          WHERE x.status = 'issued'
            -- made in the register, or moved in from the achievement module (16 Nov 2026: one list in the app)
            AND (x.template_version_id IS NOT NULL OR x.legacy_ref ~ '^achievement:[0-9]{1,18}$')
            AND (x.student_id = ANY($1::bigint[]) OR x.employee_id = $2)
          ORDER BY x.issued_on DESC, x.id DESC LIMIT 100`,
        [ids, empId],
      );
      return {
        students: me.students,
        employee: me.employee,
        types: open,
        requests: reqs.rows.map(toRow),
        certificates: certs.rows.map((x) => ({
          id: x.id,
          typeName: x.type_name,
          number: x.number,
          copyNo: x.copy_no,
          issuedOn: x.issued_on,
          person: x.person,
          studentId: x.student_id,
          purpose: x.purpose,
          revision: x.revision,
          // an award or achievement (16 Nov 2026: one list in the app, these marked)
          award: ['ACHIEVEMENT', 'MERIT', 'PARTICIPATION', 'AWARD'].includes(x.type_code),
          awardText: x.award,
          // the achievement module's record it came from (the app lists that record once, here)
          achievementId: /^achievement:\d{1,18}$/.test(x.legacy_ref ?? '')
            ? x.legacy_ref!.slice('achievement:'.length)
            : null,
        })),
      };
    });
  }

  /** A request from the app: the type must be open to the asker, the person theirs. */
  async ask(ctx: RequestContext, dto: CreateRequestDto) {
    const tenant = requireTenant(ctx);
    const id = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      const s = requestSettings(type.request);
      const me = await this.mine(c);
      let channel: 'parent' | 'student' | 'staff';
      let person: { student?: string; employee?: string };
      let name: string;
      let sectionId: string | null = null;
      if (type.audience === 'STAFF') {
        if (!me.employee || !s.open.staff)
          throw new DomainError(
            'certificate.request_closed',
            `${type.name} cannot be asked for online`,
            {
              status: 403,
            },
          );
        channel = 'staff';
        person = { employee: me.employee.id };
        name = me.employee.name;
      } else {
        const kid = dto.studentId
          ? me.students.find((k) => k.id === dto.studentId)
          : me.students.length === 1
            ? me.students[0]
            : undefined;
        if (!kid)
          throw new DomainError('not-found', 'Choose one of your children', { status: 404 });
        channel = kid.self ? 'student' : 'parent';
        if (!(kid.self ? s.open.student : s.open.parent))
          throw new DomainError(
            'certificate.request_closed',
            `${type.name} cannot be asked for online`,
            {
              status: 403,
            },
          );
        person = { student: kid.id };
        name = kid.name;
        sectionId =
          (
            await c.query<{ id: string | null }>(
              `SELECT en.class_section_id::text AS id FROM enrolments en JOIN academic_years y ON y.id = en.academic_year_id
                WHERE en.student_id = $1 AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1`,
              [kid.id],
            )
          ).rows[0]?.id ?? null;
      }
      if (dto.copies > s.maxCopies)
        throw new DomainError('validation-failed', `At most ${String(s.maxCopies)} copies`, {
          status: 400,
        });
      if (s.purposes.length && !s.purposes.includes(dto.purpose))
        throw new DomainError('validation-failed', `Choose the purpose: ${s.purposes.join(', ')}`, {
          status: 400,
        });
      const open = await c.query(
        `SELECT 1 FROM certificate_requests WHERE type_id = $1 AND status IN ('submitted', 'approved')
            AND (student_id = $2 OR employee_id = $3)`,
        [type.id, person.student ?? null, person.employee ?? null],
      );
      if (open.rowCount)
        throw new DomainError(
          'certificate.request_open',
          `A request for the ${type.name.toLowerCase()} is already open`,
          {
            status: 409,
          },
        );
      // the type's checks as they stand, for the approvers (the issue checks again)
      const yearCode = tenant.academicYearId
        ? ((
            await c.query<{ code: string }>(`SELECT code FROM academic_years WHERE id = $1`, [
              tenant.academicYearId,
            ])
          ).rows[0]?.code ?? null)
        : null;
      const checks = await runChecks(c, {
        audience: type.audience,
        studentId: person.student ?? person.employee!,
        typeId: type.id,
        rules: { ...type.rules, fees: false },
        multiple: type.multiple,
        asOf: new Date().toISOString().slice(0, 10),
        yearCode,
        ledger: null,
      });
      const r = await c.query<{ id: string }>(
        `INSERT INTO certificate_requests (school_id, type_id, student_id, employee_id, requested_by, channel, purpose, copies, note, fee_amount, checks)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id::text`,
        [
          type.id,
          person.student ?? null,
          person.employee ?? null,
          channel,
          dto.purpose,
          dto.copies,
          dto.note || null,
          s.fee && type.audience === 'STUDENT' ? (s.fee * dto.copies).toFixed(2) : null,
          JSON.stringify(checks),
        ],
      );
      const id = r.rows[0]!.id;
      if (s.levels.length) {
        const code = await this.syncDefinition(c, type);
        const inst = await this.workflow.start(c, ctx, {
          definitionCode: code,
          entityType: REQUEST_ENTITY,
          entityId: id,
          subject: `${type.name} for ${name}`.slice(0, 240),
          payload: { typeCode: type.code, sectionId, purpose: dto.purpose, copies: dto.copies },
        });
        await c.query(`UPDATE certificate_requests SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          inst.id,
        ]);
      } else await this.approved(c, ctx, id, null);
      await this.audit.stage(ctx, c, {
        action: 'certificate.request.create',
        entityType: 'certificate_requests',
        entityId: id,
        after: { type: type.code, ...person, channel, purpose: dto.purpose, copies: dto.copies },
      });
      return id;
    });
    return this.getMine(ctx, id);
  }

  /** The requester (or the child's parent) withdraws a request that is not issued yet. */
  async withdraw(ctx: RequestContext, id: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.ownRow(c, id);
      if (!['submitted', 'approved'].includes(r.status))
        throw new DomainError('certificate.request_closed', `The request is already ${r.status}`, {
          status: 409,
        });
      if (r.workflow_instance_id && r.status === 'submitted')
        await this.workflow.cancelIn(c, ctx, r.workflow_instance_id, 'Withdrawn by the requester');
      await this.closeFee(c, r);
      await c.query(
        `UPDATE certificate_requests SET status = 'withdrawn', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.request.withdraw',
        entityType: 'certificate_requests',
        entityId: id,
        before: { status: r.status },
        after: { status: 'withdrawn' },
      });
    });
    return this.getMine(ctx, id);
  }

  private async ownRow(c: PoolClient, id: string): Promise<RequestDb> {
    const me = await this.mine(c);
    const r =
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      (await c.query<RequestDb>(`${SELECT} WHERE r.id = $1`, [id])).rows[0];
    const ok =
      r &&
      (me.students.some((s) => s.id === r.student_id) ||
        (!!me.employee && me.employee.id === r.employee_id));
    if (!r || !ok) throw new DomainError('not-found', 'Request not found');
    return r;
  }

  async getMine(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => toRow(await this.ownRow(c, id)));
  }

  /** A PDF of one of the asker's own certificates (theirs or their child's): an export they own. */
  async myPdf(ctx: RequestContext, certificateId: string) {
    const own = await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.mine(c);
      const x = (
        await c.query<{
          student_id: string | null;
          employee_id: string | null;
          status: string;
          number: string;
          copy_no: number;
          type_name: string;
          versioned: boolean;
          legacy_ref: string | null;
          export_id: string | null;
          export_status: string | null;
          export_own: boolean;
        }>(
          // export_own: the file is this certificate's alone (an achievement batch's PDF holds a whole class)
          `SELECT x.student_id::text, x.employee_id::text, x.status, x.number, x.copy_no, t.name AS type_name,
                  x.template_version_id IS NOT NULL AS versioned, x.legacy_ref, x.export_id::text,
                  e.status::text AS export_status,
                  (e.dataset IN ('certificate_doc', 'certificate')
                   AND NOT EXISTS (SELECT 1 FROM certificates y WHERE y.export_id = e.id AND y.id <> x.id)) AS export_own
             FROM certificates x JOIN certificate_types t ON t.id = x.type_id
             LEFT JOIN exports e ON e.id = x.export_id WHERE x.id = $1`,
          [certificateId],
        )
      ).rows[0];
      const mineToo =
        x &&
        (me.students.some((s) => s.id === x.student_id) ||
          (!!me.employee && me.employee.id === x.employee_id));
      const achievement = !x?.versioned && /^achievement:\d{1,18}$/.test(x?.legacy_ref ?? '');
      if (!x || !mineToo || x.status !== 'issued' || !(x.versioned || achievement))
        throw new DomainError('not-found', 'Certificate not found');
      return { ...x, achievement };
    });
    // the certificate's own PDF (kept for good), when it is there or being made: the same paper the office prints
    if (
      own.export_id &&
      own.export_own &&
      ['ready', 'queued', 'running'].includes(own.export_status ?? '')
    )
      return { exportId: own.export_id, ready: own.export_status === 'ready' };
    const title = `${own.type_name} ${own.number}${own.copy_no ? ` (duplicate ${String(own.copy_no)})` : ''}`;
    const exp = await this.reports.createRenderedForOwner(
      ctx,
      own.achievement
        ? // moved in from the achievement module: its own page, from its achievement record
          {
            dataset: 'certificate',
            format: 'pdf',
            params: { certificateId: own.legacy_ref!.slice('achievement:'.length) },
            title,
          }
        : { dataset: 'certificate_doc', format: 'pdf', params: { certificateId }, title },
      'certificate.render.own',
    );
    return { exportId: exp.id, ready: false };
  }

  /** The status and link of an export the asker made. */
  async myExport(ctx: RequestContext, exportId: string) {
    // one the asker made, or the kept PDF of a certificate of their own child (or their own)
    const own = await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.mine(c);
      return c.query(
        `SELECT 1 FROM exports e
          WHERE e.id = $1
            AND (e.requested_by = app.current_user_id()
                 OR (e.dataset IN ('certificate_doc', 'certificate')
                     AND EXISTS (SELECT 1 FROM certificates x WHERE x.export_id = e.id AND x.status = 'issued'
                                   AND (x.student_id = ANY($2::bigint[]) OR x.employee_id = $3))
                     -- never a file shared with others' certificates (an achievement batch's PDF)
                     AND NOT EXISTS (SELECT 1 FROM certificates y WHERE y.export_id = e.id
                                       AND NOT COALESCE(y.student_id = ANY($2::bigint[]) OR y.employee_id = $3, false))))`,
        [exportId, me.students.map((x) => x.id), me.employee?.id ?? null],
      );
    });
    if (!own.rowCount) throw new DomainError('not-found', 'Export not found');
    return this.reports.statusForOwner(ctx, exportId);
  }

  // ---- the decision ------------------------------------------------------------------------------------------------------
  private async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    // a withdrawn request is closed by withdraw() itself
    if (instance.status === 'cancelled') return;
    if (outcome === 'approved') return this.approved(c, ctx, instance.entityId, instance);
    const note = [...instance.steps].reverse().find((s) => s.status === 'rejected')?.note ?? null;
    const r = (
      await c.query<{ requested_by: string | null; type: string; person: string }>(
        `UPDATE certificate_requests r SET status = 'rejected', decided_by = app.current_user_id(), decided_at = now(),
                decision_note = $2, updated_at = now()
           FROM certificate_types t WHERE r.id = $1 AND t.id = r.type_id
         RETURNING r.requested_by::text,
                   t.name AS type,
                   (SELECT COALESCE(s.display_name, e.display_name) FROM certificate_requests q
                      LEFT JOIN students s ON s.id = q.student_id LEFT JOIN employees e ON e.id = q.employee_id
                     WHERE q.id = r.id) AS person`,
        [instance.entityId, note],
      )
    ).rows[0];
    if (r)
      await this.tell(c, ctx, r.requested_by, 'certificate_request_rejected', {
        type: r.type,
        person: r.person,
        note: note ?? 'see the school office',
      });
  }

  /** Approved: the fee is raised on the student when the type charges one, and the requester told. */
  private async approved(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    instance: InstanceRow | null,
  ) {
    const tenant = requireTenant(ctx);
    const r = (
      await c.query<{
        student_id: string | null;
        fee_amount: string | null;
        requested_by: string | null;
        type: string;
        person: string;
      }>(
        `UPDATE certificate_requests r SET status = 'approved', decided_by = $2, decided_at = now(), updated_at = now()
           FROM certificate_types t WHERE r.id = $1 AND t.id = r.type_id AND r.status = 'submitted'
         RETURNING r.student_id::text, r.fee_amount::text, r.requested_by::text, t.name AS type,
                   (SELECT COALESCE(s.display_name, e.display_name) FROM certificate_requests q
                      LEFT JOIN students s ON s.id = q.student_id LEFT JOIN employees e ON e.id = q.employee_id
                     WHERE q.id = r.id) AS person`,
        [id, instance ? ctx.user.id : null],
      )
    ).rows[0];
    if (!r) return;
    const amount = Number(r.fee_amount ?? 0);
    if (amount > 0 && r.student_id && tenant.academicYearId) {
      const head = await c.query<{ id: string }>(
        `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
         VALUES (app.current_school_id(), 'CERTFEE', 'Certificate fee', 'misc', 'school', 920, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
      );
      const f = await c.query<{ id: string }>(
        `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, status, requested_by, announced_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4, CURRENT_DATE + 15, $5, true, 'announced', app.current_user_id(), now())
         RETURNING id::text`,
        [
          tenant.academicYearId,
          head.rows[0]!.id,
          `Certificate fee · ${r.type}`.slice(0, 120),
          amount.toFixed(2),
          `Certificate request ${id}`,
        ],
      );
      await c.query(
        `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount) VALUES (app.current_school_id(), $1, $2, $3)`,
        [f.rows[0]!.id, r.student_id, amount.toFixed(2)],
      );
      await c.query(`UPDATE certificate_requests SET misc_fee_id = $2 WHERE id = $1`, [
        id,
        f.rows[0]!.id,
      ]);
      await this.tell(c, ctx, r.requested_by, 'certificate_request_fee', {
        type: r.type,
        person: r.person,
        amount: amount.toFixed(2),
      });
    } else
      await this.tell(c, ctx, r.requested_by, 'certificate_request_approved', {
        type: r.type,
        person: r.person,
      });
  }

  /** An unpaid certificate fee is taken off when the request closes without a certificate. */
  private async closeFee(c: PoolClient, r: Pick<RequestDb, 'misc_fee_id' | 'student_id'>) {
    if (!r.misc_fee_id) return;
    await c.query(
      `UPDATE misc_fee_students SET status = 'cancelled' WHERE misc_fee_id = $1 AND student_id = $2 AND status = 'open' AND paid = 0`,
      [r.misc_fee_id, r.student_id],
    );
  }

  // ---- the office ----------------------------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: ListRequestsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      const add = (sql: (n: string) => string, v: unknown) => {
        params.push(v);
        where.push(sql(`$${String(params.length)}`));
      };
      if (q.status === 'open') where.push(`r.status IN ('submitted', 'approved')`);
      else if (q.status) add((n) => `r.status = ${n}`, q.status);
      if (q.type) add((n) => `t.code = ${n}`, q.type);
      if (q.q)
        add(
          (n) =>
            `(s.display_name ILIKE ${n} OR s.admission_no ILIKE ${n} OR e.display_name ILIKE ${n} OR e.employee_code ILIKE ${n})`,
          `%${q.q}%`,
        );
      const all = await c.query<RequestDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and the conditions are fixed fragments; values are bound parameters
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 2000`,
        params,
      );
      let rows = all.rows.map(toRow);
      if (q.mine) rows = rows.filter((x) => x.waitingWithMe);
      const figures = await c.query<{
        waiting: number;
        fee: number;
        ready: number;
        month: number;
        oldest: number | null;
      }>(
        `SELECT count(*) FILTER (WHERE r.status = 'submitted')::int AS waiting,
                count(*) FILTER (WHERE r.status = 'approved' AND r.misc_fee_id IS NOT NULL AND r.fee_waived_reason IS NULL
                                   AND NOT EXISTS (SELECT 1 FROM misc_fee_students l WHERE l.misc_fee_id = r.misc_fee_id AND l.status = 'paid'))::int AS fee,
                count(*) FILTER (WHERE r.status = 'approved' AND (r.misc_fee_id IS NULL OR r.fee_waived_reason IS NOT NULL
                                   OR EXISTS (SELECT 1 FROM misc_fee_students l WHERE l.misc_fee_id = r.misc_fee_id AND l.status = 'paid')))::int AS ready,
                count(*) FILTER (WHERE r.status = 'issued' AND r.issued_at >= date_trunc('month', now()))::int AS month,
                max(CURRENT_DATE - r.created_at::date) FILTER (WHERE r.status IN ('submitted', 'approved'))::int AS oldest
           FROM certificate_requests r`,
      );
      const mine = all.rows.filter((x) => x.mine).length;
      const total = rows.length;
      rows = rows.slice((q.page - 1) * q.size, q.page * q.size);
      return {
        rows,
        total,
        figures: { ...figures.rows[0]!, mine },
        can: {
          issue: ctx.permissions?.has(CERTIFICATE.issue) ?? false,
        },
      };
    });
  }

  /** One request for the office or one of its approvers: the request, its checks now, its levels, the fee. */
  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = (await c.query<RequestDb>(`${SELECT} WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw new DomainError('not-found', 'Request not found');
      const office = ctx.permissions?.has(CERTIFICATE.view) ?? false;
      const approver = r.workflow_instance_id
        ? (
            await c.query(
              `SELECT 1 FROM workflow_steps WHERE instance_id = $1 AND app.current_user_id() = ANY(assignee_user_ids) LIMIT 1`,
              [r.workflow_instance_id],
            )
          ).rowCount
        : 0;
      if (!office && !approver) throw new DomainError('not-found', 'Request not found');
      const instance = r.workflow_instance_id
        ? await this.workflow.instanceWith(c, r.workflow_instance_id)
        : null;
      return {
        ...toRow(r),
        levels: (instance?.steps ?? []).map((s) => ({
          level: s.level,
          name: s.name,
          status: s.status,
          assignees: s.assignees.map((a) => a.name),
          actedBy: s.actedBy,
          actedAt: s.actedAt,
          note: s.note,
        })),
        can: {
          decide: r.status === 'submitted' && r.mine,
          issue: (ctx.permissions?.has(CERTIFICATE.issue) ?? false) && stageOf(r) === 'ready',
          waive: (ctx.permissions?.has(CERTIFICATE.issue) ?? false) && stageOf(r) === 'fee',
          reject: (ctx.permissions?.has(CERTIFICATE.issue) ?? false) && r.status === 'approved',
        },
      };
    });
  }

  /** Approve or reject at the level the caller acts at. */
  async decide(ctx: RequestContext, id: string, dto: DecideRequestDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ id: string }>(
        `SELECT st.id::text FROM certificate_requests r
           JOIN workflow_instances i ON i.id = r.workflow_instance_id AND i.status = 'pending'
           JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
          WHERE r.id = $1 AND r.status = 'submitted' AND app.current_user_id() = ANY(st.assignee_user_ids)`,
        [id],
      );
      return s.rows[0]?.id;
    });
    if (!step)
      throw new DomainError('certificate.request_not_yours', 'The request does not wait with you', {
        status: 409,
      });
    if (dto.decision === 'reject' && !dto.note)
      throw new DomainError('validation-failed', 'Say why it is not approved', { status: 400 });
    await this.workflow.act(ctx, step, dto.decision === 'approve' ? 'approved' : 'rejected', {
      note: dto.note,
    });
    return this.get(ctx, id);
  }

  /** The office takes the fee off (with a reason): the request is ready to issue. */
  async waiveFee(ctx: RequestContext, id: string, reason: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = (await c.query<RequestDb>(`${SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]))
        .rows[0];
      if (!r) throw new DomainError('not-found', 'Request not found');
      if (stageOf(r) !== 'fee')
        throw new DomainError('certificate.request_no_fee', 'No fee waits on this request', {
          status: 409,
        });
      await this.closeFee(c, r);
      await c.query(
        `UPDATE certificate_requests SET fee_waived_reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.request.waive',
        entityType: 'certificate_requests',
        entityId: id,
        after: { reason },
      });
    });
    return this.get(ctx, id);
  }

  /** The office turns down an approved request (e.g. the fee was never paid). */
  async refuse(ctx: RequestContext, id: string, reason: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = (await c.query<RequestDb>(`${SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]))
        .rows[0];
      if (!r) throw new DomainError('not-found', 'Request not found');
      if (r.status !== 'approved')
        throw new DomainError(
          'certificate.request_closed',
          'Only an approved request is turned down here',
          {
            status: 409,
          },
        );
      await this.closeFee(c, r);
      await c.query(
        `UPDATE certificate_requests SET status = 'rejected', decision_note = $2, decided_by = app.current_user_id(),
                decided_at = now(), updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      await this.tell(c, ctx, r.requested_by_id, 'certificate_request_rejected', {
        type: r.type_name,
        person: r.person,
        note: reason,
      });
      await this.audit.stage(ctx, c, {
        action: 'certificate.request.refuse',
        entityType: 'certificate_requests',
        entityId: id,
        after: { reason },
      });
    });
    return this.get(ctx, id);
  }

  /**
   * Issuing against a request (called inside the issue's transaction): the request must be approved, its fee paid or
   * waived, for the same type and person; it is marked issued and the requester told.
   */
  async forIssue(
    c: PoolClient,
    requestId: string,
    typeId: string,
    person: { kind: 'student' | 'employee'; id: string },
  ): Promise<{ purpose: string | null }> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = (await c.query<RequestDb>(`${SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [requestId]))
      .rows[0];
    if (!r) throw new DomainError('not-found', 'Request not found');
    const typeOk = (
      await c.query(`SELECT 1 FROM certificate_types WHERE id = $1 AND code = $2`, [
        typeId,
        r.type_code,
      ])
    ).rowCount;
    const personOk =
      person.kind === 'student' ? r.student_id === person.id : r.employee_id === person.id;
    if (!typeOk || !personOk)
      throw new DomainError(
        'validation-failed',
        'The request is for another certificate or person',
        { status: 400 },
      );
    const stage = stageOf(r);
    if (stage !== 'ready')
      throw new DomainError(
        'certificate.request_not_ready',
        stage === 'fee' ? 'The fee of the request is not paid yet' : `The request is ${stage}`,
        { status: 409 },
      );
    return { purpose: r.purpose };
  }

  async markIssued(
    c: PoolClient,
    ctx: RequestContext,
    requestId: string,
    certificateId: string,
    number: string,
  ) {
    const r = (
      await c.query<{ requested_by: string | null; type: string; person: string }>(
        `UPDATE certificate_requests r SET status = 'issued', issued_at = now(), certificate_ids = array_append(r.certificate_ids, $2::bigint),
                updated_at = now()
           FROM certificate_types t WHERE r.id = $1 AND t.id = r.type_id
         RETURNING r.requested_by::text, t.name AS type,
                   (SELECT COALESCE(s.display_name, e.display_name) FROM certificate_requests q
                      LEFT JOIN students s ON s.id = q.student_id LEFT JOIN employees e ON e.id = q.employee_id
                     WHERE q.id = r.id) AS person`,
        [requestId, certificateId],
      )
    ).rows[0];
    if (r)
      await this.tell(c, ctx, r.requested_by, 'certificate_request_ready', {
        type: r.type,
        person: r.person,
        number,
      });
  }
}
