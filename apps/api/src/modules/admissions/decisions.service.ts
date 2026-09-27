import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { PaymentsService, type IntentRow } from '../payments/payments.service';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { AdmissionsService, type ApplicationRow } from './admissions.service';
import type { AdmitDto, DrawDto, RequestApprovalsDto, ShortlistDto } from './decisions.dto';

/** Deterministic shuffle (mulberry32 seeded from sha256 of the seed) so a draw can be audited and replayed. */
function seededOrder(ids: string[], seed: string): string[] {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Admission decisions (S9-03): shortlist by score, draw of lots, L1/L2 approvals on the workflow engine,
 * offers with the admission fee through payments v0, and admission (number, student, guardian, enrolment).
 */
@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly admissions: AdmissionsService,
    private readonly workflow: WorkflowService,
    private readonly payments: PaymentsService,
  ) {}

  private async event(
    c: PoolClient,
    applicationId: string,
    from: string,
    to: string,
    note: string | null,
    actorUserId: string | null,
  ): Promise<void> {
    await c.query(
      `UPDATE applications SET status = $2::application_status, updated_at = now(), updated_by = $3, decided_at = CASE WHEN $2 IN ('selected', 'rejected', 'waitlisted', 'admitted') THEN now() ELSE decided_at END, decided_by = CASE WHEN $2 IN ('selected', 'rejected', 'waitlisted', 'admitted') THEN $3 ELSE decided_by END WHERE id = $1`,
      [applicationId, to, actorUserId],
    );
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id) VALUES (app.current_school_id(), $1, $2::application_status, $3::application_status, $4, $5)`,
      [applicationId, from, to, note, actorUserId],
    );
  }

  async shortlist(
    ctx: RequestContext,
    cycleId: string,
    dto: ShortlistDto,
  ): Promise<{ shortlisted: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [cycleId, dto.classId];
      let limit = '';
      let score = '';
      if (dto.minScore !== undefined) {
        params.push(dto.minScore);
        score = `AND a.score >= $${params.length}::numeric`;
      }
      if (dto.count !== undefined) {
        params.push(dto.count);
        // eslint-disable-next-line no-restricted-syntax -- placeholder number only; the value is a bound parameter
        limit = `LIMIT $${params.length}::int`;
      }
      const r = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- score and limit are fixed fragments chosen by the request shape; values are bound parameters
        `SELECT a.id::text FROM applications a WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.status IN ('submitted', 'under_review') ${score}
          ORDER BY a.score DESC NULLS LAST, a.submitted_at ASC ${limit}`,
        params,
      );
      for (const row of r.rows)
        await this.event(
          c,
          row.id,
          'submitted',
          'shortlisted',
          'Shortlisted by score',
          ctx.user.id,
        );
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.shortlist',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { classId: dto.classId, count: r.rows.length, minScore: dto.minScore ?? null },
      });
      return { shortlisted: r.rows.length };
    });
  }

  /** Draw of lots among the shortlisted (or, if none, the submitted) for the seats left in the class. */
  async draw(ctx: RequestContext, cycleId: string, dto: DrawDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const crit = await c.query<{ seats: number; taken: number }>(
        `SELECT k.seats, (SELECT count(*)::int FROM applications a WHERE a.cycle_id = k.cycle_id AND a.class_id = k.class_id AND a.status IN ('selected', 'admitted')) AS taken
           FROM admission_class_criteria k WHERE k.cycle_id = $1 AND k.class_id = $2`,
        [cycleId, dto.classId],
      );
      if (!crit.rows[0])
        throw new DomainError('admission.class_not_open', 'This class is not part of the cycle', {
          status: 422,
        });
      const seats = dto.seats ?? Math.max(crit.rows[0].seats - crit.rows[0].taken, 0);
      if (seats <= 0)
        throw new DomainError('admission.no_seats', 'No seats left to draw for this class', {
          status: 409,
        });
      let pool = await c.query<{ id: string }>(
        `SELECT id::text FROM applications WHERE cycle_id = $1 AND class_id = $2 AND status = 'shortlisted' ORDER BY id`,
        [cycleId, dto.classId],
      );
      if (pool.rowCount === 0)
        pool = await c.query<{ id: string }>(
          `SELECT id::text FROM applications WHERE cycle_id = $1 AND class_id = $2 AND status IN ('submitted', 'under_review') ORDER BY id`,
          [cycleId, dto.classId],
        );
      if (pool.rowCount === 0)
        throw new DomainError('admission.no_candidates', 'No candidates to draw from', {
          status: 409,
        });
      const seed = dto.seed ?? `${cycleId}:${dto.classId}:${Date.now()}`;
      const picked = seededOrder(
        pool.rows.map((x) => x.id),
        seed,
      ).slice(0, seats);
      const draw = await c.query<{ id: string }>(
        `INSERT INTO admission_draws (school_id, cycle_id, class_id, seed, candidates, seats, picked, run_by) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::bigint[], app.current_user_id()) RETURNING id::text`,
        [cycleId, dto.classId, seed, pool.rowCount, seats, picked],
      );
      for (const id of picked) {
        const cur = await c.query<{ status: string }>(
          `SELECT status::text FROM applications WHERE id = $1`,
          [id],
        );
        await this.event(
          c,
          id,
          cur.rows[0]!.status,
          'shortlisted',
          `Drawn (draw ${draw.rows[0]!.id})`,
          ctx.user.id,
        );
      }
      for (const row of pool.rows.filter((x) => !picked.includes(x.id))) {
        const cur = await c.query<{ status: string }>(
          `SELECT status::text FROM applications WHERE id = $1`,
          [row.id],
        );
        if (cur.rows[0]!.status !== 'waitlisted')
          await this.event(
            c,
            row.id,
            cur.rows[0]!.status,
            'waitlisted',
            `Not drawn (draw ${draw.rows[0]!.id})`,
            ctx.user.id,
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.draw',
        entityType: 'admission_draws',
        entityId: draw.rows[0]!.id,
        after: { classId: dto.classId, seed, candidates: pool.rowCount, seats, picked },
      });
      return { drawId: draw.rows[0]!.id, seed, candidates: pool.rowCount, seats, picked };
    });
  }

  private async startApproval(
    c: PoolClient,
    ctx: RequestContext,
    app: ApplicationRow,
  ): Promise<InstanceRow> {
    if (app.status !== 'shortlisted')
      throw new DomainError(
        'admission.not_shortlisted',
        'Only shortlisted applications go for approval',
        { status: 409, extra: { applicationId: app.id } },
      );
    const instance = await this.workflow.start(c, ctx, {
      definitionCode: 'admission_approval',
      entityType: 'application',
      entityId: app.id,
      subject: `${app.applicationNo ?? app.id} · ${app.childName} · Class ${app.classCode}`,
      payload: {
        applicationNo: app.applicationNo,
        childName: app.childName,
        classCode: app.classCode,
        score: app.score,
      },
    });
    await c.query(
      `UPDATE applications SET workflow_instance_id = $2, updated_at = now() WHERE id = $1`,
      [app.id, instance.id],
    );
    await this.event(
      c,
      app.id,
      'shortlisted',
      'under_review',
      `Sent for approval (${instance.definitionName})`,
      ctx.user.id,
    );
    return instance;
  }

  async requestApproval(ctx: RequestContext, applicationId: string): Promise<InstanceRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const app = await this.admissions.applicationWith(c, applicationId);
      const instance = await this.startApproval(c, ctx, app);
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.request_approval',
        entityType: 'applications',
        entityId: applicationId,
        after: { instanceId: instance.id },
      });
      return instance;
    });
  }

  async requestApprovals(
    ctx: RequestContext,
    cycleId: string,
    dto: RequestApprovalsDto,
  ): Promise<{ started: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM applications WHERE cycle_id = $1 AND status = 'shortlisted' AND ($2::bigint IS NULL OR class_id = $2::bigint) ORDER BY score DESC NULLS LAST, id`,
        [cycleId, dto.classId ?? null],
      );
      let started = 0;
      for (const row of r.rows) {
        const app = await this.admissions.applicationWith(c, row.id);
        await this.startApproval(c, ctx, app);
        started += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.request_approvals',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { classId: dto.classId ?? null, started },
      });
      return { started };
    });
  }

  /** Workflow completion: approved → selected with an offer and a fee intent; rejected → rejected. */
  async onApprovalComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const app = await this.admissions.applicationWith(c, instance.entityId);
    if (outcome === 'rejected') {
      await this.event(c, app.id, app.status, 'rejected', 'Approval rejected', ctx.user.id);
      return;
    }
    await this.event(
      c,
      app.id,
      app.status,
      'selected',
      'Approved at every level; offer issued',
      ctx.user.id,
    );
    const fee = await c.query<{ fee: string | null }>(
      `SELECT app.setting('admissions.admission_fee') #>> '{}' AS fee`,
    );
    const amount = Number(fee.rows[0]?.fee ?? 10000);
    let intent: IntentRow | null = null;
    if (amount > 0) {
      const applicant = await c.query<{
        mobile: string;
        name: string | null;
        email: string | null;
      }>(`SELECT mobile, name, email FROM applicants WHERE id = $1`, [app.applicantId]);
      const email =
        typeof app.data.email === 'string'
          ? app.data.email
          : (applicant.rows[0]?.email ?? 'applicant@example.invalid');
      const schoolCode = await c.query<{ code: string }>(
        `SELECT code FROM schools WHERE id = app.current_school_id()`,
      );
      intent = await this.payments.createIntent(c, {
        purpose: 'admission_fee',
        entityType: 'application',
        entityId: app.id,
        ledger: 'admission',
        amount,
        payer: {
          name: applicant.rows[0]?.name ?? app.childName,
          email,
          mobile: applicant.rows[0]?.mobile ?? '',
        },
        returnUrl: `${this.env.PUBLIC_APP_URL}/${schoolCode.rows[0]?.code.toLowerCase() ?? ''}/status`,
        createdByApplicant: app.applicantId,
        requestId: ctx.requestId,
      });
    }
    await c.query(
      `INSERT INTO admission_offers (school_id, application_id, expires_at, admission_fee, intent_id, status, accepted_at, created_by)
       VALUES (app.current_school_id(), $1, now() + interval '7 days', $2, $3, $4::offer_status, CASE WHEN $4 = 'accepted' THEN now() END, app.current_user_id())
       ON CONFLICT (application_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, admission_fee = EXCLUDED.admission_fee, intent_id = EXCLUDED.intent_id, status = EXCLUDED.status, updated_at = now()`,
      [app.id, amount, intent?.id ?? null, amount > 0 ? 'offered' : 'accepted'],
    );
    if (amount === 0)
      await c.query(`UPDATE applications SET fee_paid_at = now() WHERE id = $1`, [app.id]);
  }

  /** Payment success for an admission fee: the offer is accepted. */
  async onFeePaid(c: PoolClient, intent: IntentRow): Promise<void> {
    if (!intent.entityId) return;
    await c.query(
      `UPDATE admission_offers SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE application_id = $1 AND status = 'offered'`,
      [intent.entityId],
    );
    await c.query(`UPDATE applications SET fee_paid_at = now(), updated_at = now() WHERE id = $1`, [
      intent.entityId,
    ]);
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_applicant_id) VALUES (app.current_school_id(), $1, 'selected', 'selected', $2, (SELECT applicant_id FROM applications WHERE id = $1))`,
      [
        intent.entityId,
        `Admission fee ₹${intent.amount} received (${intent.providerRef ?? intent.txnId})`,
      ],
    );
  }

  /** Selected + fee paid → admission number, student, guardian, enrolment in the cycle's year. */
  async admit(ctx: RequestContext, applicationId: string, dto: AdmitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const app = await this.admissions.applicationWith(c, applicationId);
      if (app.status !== 'selected')
        throw new DomainError(
          'admission.not_selected',
          'Only selected applications can be admitted',
          { status: 409 },
        );
      const offer = await c.query<{ status: string; admission_fee: string }>(
        `SELECT status::text, admission_fee::text FROM admission_offers WHERE application_id = $1`,
        [applicationId],
      );
      const feeOk =
        offer.rows[0]?.status === 'accepted' || Number(offer.rows[0]?.admission_fee ?? 0) === 0;
      if (!feeOk && !dto.waiveFeeCheck)
        throw new DomainError('admission.fee_pending', 'The admission fee has not been paid', {
          status: 409,
        });
      const cycle = await c.query<{ academic_year_id: string; start_date: string }>(
        `SELECT c.academic_year_id::text, y.start_date::text FROM admission_cycles c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.id = $1`,
        [app.cycleId],
      );
      const yearId = cycle.rows[0]!.academic_year_id;
      let sectionId = dto.classSectionId;
      if (!sectionId) {
        const pick = await c.query<{ id: string }>(
          `SELECT cs.id::text FROM class_sections cs WHERE cs.academic_year_id = $1 AND cs.class_id = $2 AND cs.deleted_at IS NULL
            ORDER BY (COALESCE(cs.capacity, 40) - (SELECT count(*) FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active')) DESC, cs.name LIMIT 1`,
          [yearId, app.classId],
        );
        sectionId = pick.rows[0]?.id;
      }
      if (!sectionId)
        throw new DomainError(
          'admission.no_section',
          'Create sections of this class in the target year first',
          { status: 409 },
        );
      const admissionNo = (await c.query<{ no: string }>(`SELECT app.next_admission_no() AS no`))
        .rows[0]!.no;
      const category = typeof app.data.category === 'string' ? app.data.category : null;
      const student = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, admitted_on, details, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6, CURRENT_DATE, $7::jsonb, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
        [
          admissionNo,
          app.childFirstName,
          app.childLastName,
          app.childDob,
          app.childGender,
          category,
          JSON.stringify({
            applicationNo: app.applicationNo,
            previousSchool: app.data.previousSchool ?? null,
          }),
        ],
      );
      const studentId = student.rows[0]!.id;
      const applicant = await c.query<{
        mobile: string;
        name: string | null;
        email: string | null;
      }>(`SELECT mobile, name, email FROM applicants WHERE id = $1`, [app.applicantId]);
      const guardianName =
        (typeof app.data.fatherName === 'string' && app.data.fatherName) ||
        applicant.rows[0]?.name ||
        'Guardian';
      const [gFirst, ...gRest] = guardianName.split(/\s+/);
      const existing = await c.query<{ id: string }>(
        `SELECT id::text FROM guardians WHERE mobile = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
        [applicant.rows[0]!.mobile],
      );
      const guardianId =
        existing.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, created_by, updated_by) VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
            [
              gFirst,
              gRest.join(' ') || null,
              applicant.rows[0]!.mobile,
              typeof app.data.email === 'string'
                ? app.data.email
                : (applicant.rows[0]?.email ?? null),
            ],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, created_by) VALUES (app.current_school_id(), $1, $2, 'father', true, app.current_user_id())`,
        [studentId, guardianId],
      );
      const enrolment = await c.query<{ id: string }>(
        `SELECT app.enrol_student($1, $2, $3, $4, $5::date)::text AS id`,
        [studentId, yearId, sectionId, dto.rollNo ?? null, cycle.rows[0]!.start_date],
      );
      await c.query(`UPDATE applications SET student_id = $2 WHERE id = $1`, [
        applicationId,
        studentId,
      ]);
      await this.event(
        c,
        applicationId,
        'selected',
        'admitted',
        `Admitted as ${admissionNo}`,
        ctx.user.id,
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.admit',
        entityType: 'applications',
        entityId: applicationId,
        after: { admissionNo, studentId, classSectionId: sectionId },
      });
      return {
        applicationId,
        admissionNo,
        studentId,
        enrolmentId: enrolment.rows[0]!.id,
        classSectionId: sectionId,
      };
    });
  }

  /** The offer of an application for staff readers (admin application page). */
  async offer(ctx: RequestContext, applicationId: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.offerFor(c, applicationId));
  }

  /** Offer and payment form for the applicant's own application (public status page). */
  async offerFor(c: PoolClient, applicationId: string) {
    const r = await c.query<{
      status: string;
      admission_fee: string;
      expires_at: Date;
      intent_id: string | null;
      accepted_at: Date | null;
    }>(
      `SELECT status::text, admission_fee::text, expires_at, intent_id::text, accepted_at FROM admission_offers WHERE application_id = $1`,
      [applicationId],
    );
    const o = r.rows[0];
    if (!o) return null;
    let intent: IntentRow | null = null;
    if (o.intent_id) {
      const i = await c.query<{ txn_id: string }>(
        `SELECT txn_id FROM payment_intents WHERE id = $1`,
        [o.intent_id],
      );
      intent = i.rows[0] ? await this.payments.findByTxn(c, i.rows[0].txn_id) : null;
    }
    return {
      status: o.status,
      admissionFee: o.admission_fee,
      expiresAt: o.expires_at.toISOString(),
      acceptedAt: o.accepted_at ? o.accepted_at.toISOString() : null,
      payment: intent
        ? {
            status: intent.status,
            txnId: intent.txnId,
            form: intent.status === 'succeeded' ? null : this.payments.gatewayForm(intent),
          }
        : null,
    };
  }
}
