import { messageTag } from './message-tag';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { admitCardPdf, meritListPdf } from './admission-pdf';
import { classPointRules } from './points-rules';
import { meritOrder, seededOrder, TIE_RULE } from './merit-order';
import { slotOf } from './process-engine';
import { AdmissionProcessService } from './process.service';
import type {
  AllotDto,
  SelectIdsDto,
  SelectionDrawDto,
  SelectionNextDto,
  SlotDto,
  SlotResultsDto,
} from './process.dto';

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/** Registrations waiting at a stage (of a session, a class when given) that have no slot for it yet. */
const WAITING_AT = `a.cycle_id = $1 AND a.status::text IN ('registered', 'under_review') AND a.process_steps IS NOT NULL
  AND (a.process_steps -> a.stage_no ->> 'stageId') = $2::text AND ($3::bigint IS NULL OR a.class_id = $3::bigint)`;

/**
 * Tests, interviews and selection of online admission (docs/design/39, part 4): slots with date, venue and
 * capacity; candidates allotted (the next waiting, or chosen) with a roll number and a mailed schedule; the
 * admit card; attendance, marks and the decision per candidate; the merit list with seats per category,
 * offers, the waiting list, a replayable draw, and lapsed offers making room for the next on the list.
 */
@Injectable()
export class AdmissionScheduleService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly process: AdmissionProcessService,
    private readonly audit: AuditService,
  ) {}

  // ---- slots ------------------------------------------------------------------------------------
  async slots(ctx: RequestContext, cycleId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cyc = await c.query<{ name: string }>(
        `SELECT name FROM admission_cycles WHERE id = $1 AND deleted_at IS NULL`,
        [cycleId],
      );
      if (!cyc.rows[0]) throw new DomainError('not-found', 'Session not found', { status: 404 });
      const r = await c.query<{
        id: string;
        stage_id: string;
        stage: string;
        kind: string;
        class_id: string | null;
        class_name: string | null;
        starts_at: Date;
        minutes: number;
        venue: string;
        capacity: number;
        notes: string | null;
        allotted: number;
        marked: number;
      }>(
        `SELECT s.id::text, s.stage_id::text, st.name AS stage, st.kind, s.class_id::text, cl.name AS class_name, s.starts_at, s.minutes,
                s.venue, s.capacity, s.notes, count(x.id)::int AS allotted,
                count(r.id)::int AS marked
           FROM admission_slots s JOIN admission_stages st ON st.id = s.stage_id LEFT JOIN classes cl ON cl.id = s.class_id
           LEFT JOIN admission_slot_allotments x ON x.slot_id = s.id
           LEFT JOIN LATERAL (SELECT r.id FROM admission_stage_results r WHERE r.application_id = x.application_id AND r.stage_id = s.stage_id
                               AND r.undone_at IS NULL LIMIT 1) r ON true
          WHERE s.cycle_id = $1 GROUP BY s.id, st.id, cl.id ORDER BY s.starts_at, s.id`,
        [cycleId],
      );
      // stages used by the processes of the session's classes that take slots, with how many wait
      const stages = await c.query<{ id: string; name: string; kind: string; waiting: number }>(
        `SELECT st.id::text, st.name, st.kind,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND a.status::text IN ('registered', 'under_review')
                    AND (a.process_steps -> a.stage_no ->> 'stageId') = st.id::text
                    AND NOT EXISTS (SELECT 1 FROM admission_slot_allotments x WHERE x.application_id = a.id AND x.stage_id = st.id)) AS waiting
           FROM admission_stages st WHERE st.status = 'active' AND st.kind IN ('test', 'interview', 'interaction', 'custom')
          ORDER BY st.sort_order, st.id`,
        [cycleId],
      );
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT cl.id::text, cl.name FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id WHERE k.cycle_id = $1 ORDER BY cl.display_order`,
        [cycleId],
      );
      return {
        session: { id: cycleId, name: cyc.rows[0].name },
        stages: stages.rows,
        classes: classes.rows,
        slots: r.rows.map((s) => ({
          id: s.id,
          stageId: s.stage_id,
          stage: s.stage,
          kind: s.kind,
          classId: s.class_id,
          className: s.class_name,
          startsAt: s.starts_at.toISOString(),
          minutes: s.minutes,
          venue: s.venue,
          capacity: s.capacity,
          notes: s.notes,
          allotted: s.allotted,
          marked: s.marked,
        })),
      };
    });
  }

  async createSlot(ctx: RequestContext, cycleId: string, dto: SlotDto) {
    const id = await this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await c.query<{ kind: string }>(
        `SELECT kind FROM admission_stages WHERE id = $1 AND status = 'active'`,
        [dto.stageId],
      );
      if (!st.rows[0] || ['document_check', 'selection'].includes(st.rows[0].kind))
        throw new DomainError(
          'validation-failed',
          'Slots are for tests, interviews and interactions',
          { status: 400 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_slots (school_id, cycle_id, stage_id, class_id, starts_at, minutes, venue, capacity, notes)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
        [
          cycleId,
          dto.stageId,
          dto.classId ?? null,
          dto.startsAt,
          dto.minutes,
          dto.venue,
          dto.capacity,
          dto.notes ?? null,
        ],
      );
      return r.rows[0]!.id;
    });
    return this.slot(ctx, id);
  }

  async updateSlot(ctx: RequestContext, id: string, dto: SlotDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const n = await c.query<{ n: number; stage_id: string }>(
        `SELECT s.stage_id::text, (SELECT count(*)::int FROM admission_slot_allotments x WHERE x.slot_id = s.id) AS n FROM admission_slots s WHERE s.id = $1`,
        [id],
      );
      if (!n.rows[0]) throw new DomainError('not-found', 'Slot not found', { status: 404 });
      if (n.rows[0].n > dto.capacity)
        throw new DomainError(
          'validation-failed',
          `${n.rows[0].n} candidates are allotted: the capacity cannot be less`,
          { status: 400 },
        );
      if (n.rows[0].n && n.rows[0].stage_id !== dto.stageId)
        throw new DomainError(
          'validation-failed',
          'Candidates are allotted: the stage cannot change',
          { status: 400 },
        );
      await c.query(
        `UPDATE admission_slots SET stage_id = $2, class_id = $3, starts_at = $4, minutes = $5, venue = $6, capacity = $7, notes = $8 WHERE id = $1`,
        [
          id,
          dto.stageId,
          dto.classId ?? null,
          dto.startsAt,
          dto.minutes,
          dto.venue,
          dto.capacity,
          dto.notes ?? null,
        ],
      );
    });
    return this.slot(ctx, id);
  }

  async deleteSlot(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM admission_slot_allotments WHERE slot_id = $1`,
        [id],
      );
      if (n.rows[0]!.n)
        throw new DomainError(
          'admissions.slot_in_use',
          'Candidates are allotted to this slot: move them first',
          { status: 409 },
        );
      await c.query(`DELETE FROM admission_slots WHERE id = $1`, [id]);
      return { removed: true };
    });
  }

  private async slotRow(c: PoolClient, id: string) {
    const r = await c.query<{
      id: string;
      cycle_id: string;
      cycle_name: string;
      stage_id: string;
      stage: string;
      kind: string;
      max_marks: string | null;
      class_id: string | null;
      class_name: string | null;
      starts_at: Date;
      minutes: number;
      venue: string;
      capacity: number;
      notes: string | null;
    }>(
      `SELECT s.id::text, s.cycle_id::text, y.name AS cycle_name, s.stage_id::text, st.name AS stage, st.kind, st.max_marks::text,
              s.class_id::text, cl.name AS class_name, s.starts_at, s.minutes, s.venue, s.capacity, s.notes
         FROM admission_slots s JOIN admission_stages st ON st.id = s.stage_id JOIN admission_cycles y ON y.id = s.cycle_id
         LEFT JOIN classes cl ON cl.id = s.class_id WHERE s.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Slot not found', { status: 404 });
    return r.rows[0];
  }

  async slot(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.slotRow(c, id);
      const list = await c.query<{
        application_id: string;
        roll_no: number;
        number: string | null;
        candidate: string | null;
        class_name: string;
        status: string;
        at_stage: boolean;
        notified_at: Date | null;
        attendance: string | null;
        marks: string | null;
        decision: string | null;
        remarks: string | null;
      }>(
        `SELECT x.application_id::text, x.roll_no, a.application_no AS number, a.candidate_name AS candidate, cl.name AS class_name,
                a.status::text, (a.process_steps -> a.stage_no ->> 'stageId') = x.stage_id::text AS at_stage, x.notified_at,
                r.attendance, r.marks::text, r.decision, r.remarks
           FROM admission_slot_allotments x JOIN applications a ON a.id = x.application_id JOIN classes cl ON cl.id = a.class_id
           LEFT JOIN LATERAL (SELECT * FROM admission_stage_results r WHERE r.application_id = a.id AND r.stage_id = x.stage_id
                               AND r.level = 1 AND r.undone_at IS NULL ORDER BY r.decided_at DESC LIMIT 1) r ON true
          WHERE x.slot_id = $1 ORDER BY x.roll_no`,
        [id],
      );
      const waiting = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- WAITING_AT is a constant; values are bound parameters
        `SELECT count(*)::int AS n FROM applications a WHERE ${WAITING_AT}
            AND NOT EXISTS (SELECT 1 FROM admission_slot_allotments x WHERE x.application_id = a.id AND x.stage_id = $2::bigint)`,
        [s.cycle_id, s.stage_id, s.class_id],
      );
      return {
        id: s.id,
        session: { id: s.cycle_id, name: s.cycle_name },
        stageId: s.stage_id,
        stage: s.stage,
        kind: s.kind,
        maxMarks: s.max_marks !== null ? Number(s.max_marks) : null,
        classId: s.class_id,
        className: s.class_name,
        startsAt: s.starts_at.toISOString(),
        minutes: s.minutes,
        venue: s.venue,
        capacity: s.capacity,
        notes: s.notes,
        waiting: waiting.rows[0]?.n ?? 0,
        candidates: list.rows.map((x) => ({
          applicationId: x.application_id,
          rollNo: x.roll_no,
          number: x.number,
          candidate: x.candidate,
          className: x.class_name,
          status: x.status,
          atStage: x.at_stage,
          notified: Boolean(x.notified_at),
          attendance: x.attendance,
          marks: x.marks !== null ? Number(x.marks) : null,
          decision: x.decision,
          remarks: x.remarks,
        })),
      };
    });
  }

  /** Candidates into a slot: the chosen ones, or the next waiting up to the room left; the schedule mailed. */
  async allot(ctx: RequestContext, id: string, dto: AllotDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.slotRow(c, id);
      await c.query(`SELECT 1 FROM admission_slots WHERE id = $1 FOR UPDATE`, [id]);
      const taken = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM admission_slot_allotments WHERE slot_id = $1`,
        [id],
      );
      const room = s.capacity - (taken.rows[0]?.n ?? 0);
      if (room <= 0)
        throw new DomainError('admissions.slot_full', 'This slot is full', { status: 409 });
      const pick = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- WAITING_AT is a constant; values are bound parameters
        `SELECT a.id::text FROM applications a WHERE ${WAITING_AT}
            AND NOT EXISTS (SELECT 1 FROM admission_slot_allotments x WHERE x.application_id = a.id AND x.stage_id = $2::bigint)
            AND ($4::bigint[] IS NULL OR a.id = ANY($4::bigint[]))
          ORDER BY a.registered_at, a.id LIMIT $5`,
        [s.cycle_id, s.stage_id, s.class_id, dto.applicationIds ?? null, room],
      );
      if (dto.applicationIds && pick.rows.length < Math.min(dto.applicationIds.length, room))
        throw new DomainError(
          'validation-failed',
          'Some candidates are not waiting at this stage (or have a slot already)',
          { status: 400 },
        );
      if (dto.applicationIds && dto.applicationIds.length > room)
        throw new DomainError('admissions.slot_full', `Only ${room} more fit in this slot`, {
          status: 409,
        });
      for (const row of pick.rows) {
        const roll = await c.query<{ n: number }>(
          `SELECT COALESCE(max(x.roll_no), 0)::int + 1 AS n FROM admission_slot_allotments x JOIN admission_slots s ON s.id = x.slot_id
            WHERE s.cycle_id = $1 AND x.stage_id = $2`,
          [s.cycle_id, s.stage_id],
        );
        await c.query(
          `INSERT INTO admission_slot_allotments (school_id, slot_id, stage_id, application_id, roll_no) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
          [id, s.stage_id, row.id, roll.rows[0]!.n],
        );
        const a = await this.core.row(c, row.id);
        await this.core.event(
          c,
          a.id,
          a.status,
          a.status,
          `${s.stage}: ${when(s.starts_at)} at ${s.venue} (roll no. ${roll.rows[0]!.n})`,
          {
            actorUser: ctx.user.id,
          },
        );
        if (dto.notify) {
          await c.query(
            `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8)`,
            [
              'admission_schedule',
              a.contact_mobile,
              a.contact_email,
              JSON.stringify({
                ...messageTag('status', { applicationId: a.id }),
                name: a.candidate_name ?? '',
                number: a.application_no ?? '',
                stage: s.stage,
                when: when(s.starts_at),
                venue: s.venue,
              }),
              `${s.stage}: ${when(s.starts_at)}`,
              `The ${s.stage.toLowerCase()} of ${a.candidate_name ?? 'your ward'} is scheduled.`,
              JSON.stringify([
                ['Candidate', a.candidate_name ?? ''],
                ['Registration no.', a.application_no ?? ''],
                ['Roll no.', String(roll.rows[0]!.n)],
                ['Date and time', when(s.starts_at)],
                ['Venue', s.venue],
              ]),
              'Download the admit card from the admission portal and bring it with you.',
            ],
          );
          await c.query(
            `UPDATE admission_slot_allotments SET notified_at = now() WHERE application_id = $1 AND stage_id = $2`,
            [row.id, s.stage_id],
          );
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.slot.allot',
        entityType: 'admission_slots',
        entityId: id,
        after: { allotted: pick.rows.length },
      });
    });
    return this.slot(ctx, id);
  }

  async unallot(ctx: RequestContext, id: string, applicationId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.slotRow(c, id);
      const done = await c.query(
        `SELECT 1 FROM admission_stage_results WHERE application_id = $1 AND stage_id = $2 AND undone_at IS NULL LIMIT 1`,
        [applicationId, s.stage_id],
      );
      if (done.rows.length)
        throw new DomainError(
          'admissions.slot_marked',
          'A decision is recorded for this candidate: undo it first',
          { status: 409 },
        );
      await c.query(
        `DELETE FROM admission_slot_allotments WHERE slot_id = $1 AND application_id = $2`,
        [id, applicationId],
      );
    });
    return this.slot(ctx, id);
  }

  /** Attendance, marks and the decision for the candidates of a slot (each at the level they wait at). */
  async results(ctx: RequestContext, id: string, dto: SlotResultsDto) {
    const errors: Array<{ applicationId: string; error: string }> = [];
    let saved = 0;
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.slotRow(c, id);
      const inSlot = await c.query<{ id: string }>(
        `SELECT application_id::text AS id FROM admission_slot_allotments WHERE slot_id = $1`,
        [id],
      );
      const ids = new Set(inSlot.rows.map((x) => x.id));
      for (const row of dto.rows) {
        if (!ids.has(row.applicationId)) {
          errors.push({ applicationId: row.applicationId, error: 'not in this slot' });
          continue;
        }
        const at = await c.query<{ ok: boolean }>(
          `SELECT (process_steps -> stage_no ->> 'stageId') = $2::text AND status::text IN ('registered', 'under_review') AS ok FROM applications WHERE id = $1`,
          [row.applicationId, s.stage_id],
        );
        if (!at.rows[0]?.ok) {
          errors.push({ applicationId: row.applicationId, error: 'already decided at this stage' });
          continue;
        }
        await this.process.decideWith(c, ctx, row.applicationId, {
          decision:
            row.attendance === 'absent' && row.decision === 'approve' ? 'hold' : row.decision,
          attendance: row.attendance ?? null,
          marks: row.attendance === 'absent' ? null : (row.marks ?? null),
          remarks: row.remarks,
        });
        saved += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.slot.results',
        entityType: 'admission_slots',
        entityId: id,
        after: { saved, skipped: errors.length },
      });
    });
    return { saved, errors, slot: await this.slot(ctx, id) };
  }

  /** The admit card of the latest slot of an application (office or portal). */
  async admitCardWith(c: PoolClient, appId: string): Promise<{ filename: string; bytes: Buffer }> {
    const a = await this.core.row(c, appId);
    const s = await slotOf(c, appId);
    if (!s)
      throw new DomainError(
        'not-found',
        'No test or interview is scheduled for this registration',
        { status: 404 },
      );
    const school = await c.query<{
      name: string;
      address: string | null;
      contact: string | null;
      logo: string | null;
    }>(
      `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
              NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
         FROM schools WHERE id = app.current_school_id()`,
    );
    const def = await this.core.defOf(c, a);
    const data = this.core.plainData(def, a.data);
    const photoField = def.fields.find((f) => f.type === 'photo');
    const photoId =
      photoField && Array.isArray(data[photoField.key])
        ? (data[photoField.key] as string[])[0]
        : null;
    const sc = school.rows[0]!;
    const bytes = await admitCardPdf({
      school: {
        name: sc.name,
        address: sc.address,
        contact: sc.contact ? `Phone ${sc.contact}` : null,
      },
      logo: await this.core.fileBytes(c, sc.logo),
      photo: await this.core.fileBytes(c, photoId),
      title: `Admit card: ${s.stage}`,
      rows: [
        ['Candidate', a.candidate_name ?? ''],
        ['Registration no.', a.application_no ?? ''],
        ['Roll no.', String(s.rollNo)],
        ['Class sought', a.class_name],
        ['Session', a.cycle_name],
        ['Date and time', when(new Date(s.startsAt))],
        ['Duration', `${s.minutes} minutes`],
        ['Venue', s.venue],
      ],
      instructions: [
        'Reach the school 30 minutes before the time; carry this card (printed or on the phone).',
        'A parent must accompany the candidate.',
        ...(s.notes ? [s.notes] : []),
      ],
    });
    return {
      filename: `admit-card-${(a.application_no ?? a.id).replace(/[^\w-]+/g, '-')}.pdf`,
      bytes,
    };
  }

  async admitCard(ctx: RequestContext, appId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.admitCardWith(c, appId);
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  // ---- selection --------------------------------------------------------------------------------
  /** Offers past their last date lapse; the place goes back to the waiting list's turn. */
  private async lapse(c: PoolClient, cycleId: string) {
    const r = await c.query<{ id: string }>(
      `UPDATE applications SET status = 'withdrawn', updated_at = now()
        WHERE cycle_id = $1 AND status = 'offered' AND offer_expires_at < now() RETURNING id::text`,
      [cycleId],
    );
    for (const x of r.rows)
      await this.core.event(
        c,
        x.id,
        'offered',
        'withdrawn',
        'Offer lapsed: the admission fee was not paid by the last date',
        {},
      );
    return r.rows.length;
  }

  async selection(ctx: RequestContext, cycleId: string, classId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lapsed = await this.lapse(c, cycleId);
      const line = await c.query<{
        seats: number;
        class_name: string;
        cycle_name: string;
        offer_days: number;
        merit_seed: string | null;
        merit_seed_at: Date | null;
      }>(
        `SELECT k.seats, cl.name AS class_name, y.name AS cycle_name, y.offer_days, k.merit_seed, k.merit_seed_at FROM admission_class_criteria k
           JOIN classes cl ON cl.id = k.class_id JOIN admission_cycles y ON y.id = k.cycle_id WHERE k.cycle_id = $1 AND k.class_id = $2`,
        [cycleId, classId],
      );
      if (!line.rows[0])
        throw new DomainError('not-found', 'This class is not in the session', { status: 404 });
      const cats = await c.query<{
        id: string;
        name: string;
        seats: number | null;
        offered: number;
        paid: number;
      }>(
        `SELECT k.id::text, k.name, f.seats,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.category_id = k.id AND a.status = 'offered') AS offered,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.category_id = k.id AND a.status IN ('fee_paid', 'admitted')) AS paid
           FROM admission_fee_categories k LEFT JOIN admission_fees f ON f.category_id = k.id AND f.cycle_id = $1 AND f.class_id = $2
          WHERE k.status = 'active' ORDER BY k.sort_order, k.id`,
        [cycleId, classId],
      );
      const rows = await c.query<{
        id: string;
        number: string | null;
        candidate: string | null;
        category_id: string | null;
        category: string | null;
        status: string;
        merit: string | null;
        wait_rank: number | null;
        registered_at: Date | null;
        offer_expires_at: Date | null;
        at_selection: boolean;
        level_no: number | null;
        levels: number | null;
        dob: string | null;
        form_points: string | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.category_id::text, k.name AS category,
                a.status::text, a.merit::text, a.wait_rank, a.registered_at, a.offer_expires_at, a.child_dob::text AS dob, a.form_points::text,
                st.kind = 'selection' AS at_selection, a.level_no, jsonb_array_length(a.process_steps -> a.stage_no -> 'levels') AS levels
           FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
           LEFT JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
          WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.application_no IS NOT NULL
            AND (a.status::text IN ('offered', 'waitlisted', 'fee_paid', 'admitted')
                 OR (a.status::text IN ('registered', 'under_review') AND st.kind = 'selection'))
          ORDER BY a.merit DESC NULLS LAST, a.child_dob NULLS LAST, a.registered_at, a.id`,
        [cycleId, classId],
      );
      const pick = (x: (typeof rows.rows)[number]) => {
        const merit = x.merit !== null ? Number(x.merit) : null;
        const points = x.form_points !== null ? Number(x.form_points) : null;
        return {
          ...base(x),
          merit,
          points,
          // the marks: what the merit has beyond the form's points
          marks: merit !== null ? Math.round((merit - (points ?? 0)) * 100) / 100 : null,
          dob: x.dob,
        };
      };
      const base = (x: (typeof rows.rows)[number]) => ({
        id: x.id,
        number: x.number,
        candidate: x.candidate,
        categoryId: x.category_id,
        category: x.category,
        status: x.status,
        waitRank: x.wait_rank,
        registeredAt: x.registered_at?.toISOString() ?? null,
        offerExpiresAt: x.offer_expires_at?.toISOString() ?? null,
        level: x.level_no && x.levels && x.levels > 1 ? `${x.level_no} of ${x.levels}` : null,
      });
      // the merit list: merit, then the older child, then a recorded draw (docs/design/40, part 4)
      const waiting = rows.rows
        .filter((x) => ['registered', 'under_review'].includes(x.status))
        .map(pick);
      let seed = line.rows[0].merit_seed;
      let seedAt = line.rows[0].merit_seed_at;
      let ranked = meritOrder(waiting, seed);
      if (ranked.needsDraw && !seed) {
        seed = randomBytes(6).toString('hex');
        seedAt = new Date();
        await c.query(
          `UPDATE admission_class_criteria SET merit_seed = $3, merit_seed_at = $4 WHERE cycle_id = $1 AND class_id = $2`,
          [cycleId, classId, seed, seedAt],
        );
        await this.audit.stage(ctx, c, {
          action: 'admissions.selection.tie_seed',
          entityType: 'admission_cycles',
          entityId: cycleId,
          after: { classId, seed },
        });
        ranked = meritOrder(waiting, seed);
      }
      const taken = cats.rows.reduce((s, k) => s + k.offered + k.paid, 0);
      return {
        session: { id: cycleId, name: line.rows[0].cycle_name, offerDays: line.rows[0].offer_days },
        class: {
          id: classId,
          name: line.rows[0].class_name,
          seats: line.rows[0].seats,
          taken,
          left: Math.max(line.rows[0].seats - taken, 0),
        },
        lapsed,
        categories: cats.rows.map((k) => ({
          id: k.id,
          name: k.name,
          seats: k.seats,
          offered: k.offered,
          paid: k.paid,
        })),
        merit: ranked.order,
        tieBreak: { rule: TIE_RULE, seed, seededAt: seedAt?.toISOString() ?? null },
        waiting: rows.rows
          .filter((x) => x.status === 'waitlisted')
          .sort((a, b) => (a.wait_rank ?? 1e9) - (b.wait_rank ?? 1e9))
          .map(pick),
        offered: rows.rows
          .filter((x) => ['offered', 'fee_paid', 'admitted'].includes(x.status))
          .map(pick),
      };
    });
  }

  /** The merit list of a class as an A4 PDF: the criteria, the tie-break rule and seed, the ranks. */
  async meritList(ctx: RequestContext, cycleId: string, classId: string) {
    const sel = await this.selection(ctx, cycleId, classId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const school = await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      );
      const sc = school.rows[0]!;
      const criteria = await classPointRules(c, cycleId, classId);
      const n = (v: number | null) => (v === null ? '-' : String(v));
      const bytes = await meritListPdf({
        school: {
          name: sc.name,
          address: sc.address,
          contact: sc.contact ? `Phone ${sc.contact}` : null,
        },
        logo: await this.core.fileBytes(c, sc.logo),
        title: `Merit list: ${sel.class.name}`,
        subtitle: `${sel.session.name} · ${String(sel.class.seats)} seats, ${String(sel.class.left)} left · ${String(sel.merit.length)} candidates at Selection`,
        criteria: criteria.map((k) => ({
          name: k.name,
          points:
            k.kind === 'table'
              ? `from the score table${k.cap ? `, at most ${String(k.cap)}` : ''}`
              : k.points,
        })),
        tieRule: sel.tieBreak.rule,
        seed: sel.tieBreak.seed,
        rows: sel.merit.map((x) => ({
          rank: x.rank,
          number: x.number ?? '',
          candidate: x.candidate ?? '',
          category: x.category ?? '',
          points: n(x.points),
          marks: n(x.marks),
          merit: n(x.merit),
          note: x.tie === 'age' ? 'older first' : x.tie === 'draw' ? 'by draw' : '',
        })),
        printedAt: when(new Date()),
      });
      return {
        filename: `merit-list-${sel.class.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }

  /** Seats a category may still offer: its own quota, and the class's seats left. */
  private async room(c: PoolClient, cycleId: string, classId: string, categoryId: string | null) {
    const r = await c.query<{ class_left: number; cat_left: number | null }>(
      `SELECT k.seats - (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.status IN ('offered', 'fee_paid', 'admitted')) AS class_left,
              (SELECT f.seats - (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.category_id = f.category_id
                                   AND a.status IN ('offered', 'fee_paid', 'admitted'))
                 FROM admission_fees f WHERE f.cycle_id = $1 AND f.class_id = $2 AND f.category_id = $3 AND f.seats IS NOT NULL) AS cat_left
         FROM admission_class_criteria k WHERE k.cycle_id = $1 AND k.class_id = $2`,
      [cycleId, classId, categoryId],
    );
    const x = r.rows[0];
    if (!x) return 0;
    return Math.max(Math.min(x.class_left, x.cat_left ?? x.class_left), 0);
  }

  private async offerOne(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    cycleId: string,
    note?: string,
  ) {
    const a = await this.core.row(c, id);
    if (a.cycle_id !== cycleId)
      throw new DomainError('validation-failed', 'A candidate is not of this session', {
        status: 400,
      });
    if ((await this.room(c, cycleId, a.class_id, a.category_id)) <= 0)
      throw new DomainError(
        'admissions.no_seats',
        `No seat left for ${a.candidate_name ?? a.application_no} (${a.category_name ?? 'category'})`,
        {
          status: 409,
        },
      );
    if (a.status === 'waitlisted') {
      // the next on the list: offered straight, the list's place recorded
      await c.query(
        `INSERT INTO admission_stage_results (school_id, application_id, stage_id, level, decision, remarks, decided_by, decided_by_name)
         SELECT app.current_school_id(), a.id, (a.process_steps -> a.stage_no ->> 'stageId')::bigint,
                jsonb_array_length(a.process_steps -> a.stage_no -> 'levels'), 'offered', $2, $3, $4
           FROM applications a WHERE a.id = $1 AND a.process_steps IS NOT NULL AND a.stage_no < jsonb_array_length(a.process_steps)`,
        [id, note ?? 'Offered from the waiting list', ctx.user.id, ctx.user.displayName],
      );
      await this.process.makeOffer(c, a, ctx.user.id, note ?? 'Offered from the waiting list');
      return;
    }
    await this.process.decideWith(c, ctx, id, { decision: 'offer' }, { note });
  }

  async offer(ctx: RequestContext, cycleId: string, dto: SelectIdsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      for (const id of dto.applicationIds) await this.offerOne(c, ctx, id, cycleId);
      await this.audit.stage(ctx, c, {
        action: 'admissions.selection.offer',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { count: dto.applicationIds.length },
      });
    });
    return { offered: dto.applicationIds.length };
  }

  async waitlist(ctx: RequestContext, cycleId: string, dto: SelectIdsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      for (const id of dto.applicationIds)
        await this.process.decideWith(c, ctx, id, { decision: 'waitlist' });
      await this.audit.stage(ctx, c, {
        action: 'admissions.selection.waitlist',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { count: dto.applicationIds.length },
      });
    });
    return { waitlisted: dto.applicationIds.length };
  }

  /** A draw among the candidates at Selection (of a category): the first `seats` offered, the rest wait-listed in order. */
  async draw(ctx: RequestContext, cycleId: string, dto: SelectionDrawDto) {
    const seed = dto.seed ?? randomBytes(8).toString('hex');
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const pool = await c.query<{ id: string; number: string | null; candidate: string | null }>(
        `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate FROM applications a
           JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
          WHERE a.cycle_id = $1 AND a.class_id = $2 AND ($3::bigint IS NULL OR a.category_id = $3::bigint)
            AND a.status::text IN ('registered', 'under_review') AND st.kind = 'selection'
          ORDER BY a.application_no, a.id`,
        [cycleId, dto.classId, dto.categoryId ?? null],
      );
      if (!pool.rows.length)
        throw new DomainError(
          'admissions.nothing_to_draw',
          'No candidate waits at Selection for this draw',
          { status: 409 },
        );
      const order = seededOrder(pool.rows, seed);
      const note = `Draw (seed ${seed})`;
      const offered: string[] = [];
      const waitlisted: string[] = [];
      for (const [i, x] of order.entries()) {
        if (i < dto.seats) {
          await this.offerOne(c, ctx, x.id, cycleId, note);
          offered.push(x.id);
        } else {
          await this.process.decideWith(c, ctx, x.id, { decision: 'waitlist' }, { note });
          waitlisted.push(x.id);
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.selection.draw',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: {
          classId: dto.classId,
          categoryId: dto.categoryId ?? null,
          seed,
          seats: dto.seats,
          order: order.map((x) => x.number),
        },
      });
      return {
        order: order.map((x, i) => ({
          id: x.id,
          number: x.number,
          candidate: x.candidate,
          rank: i + 1,
          offered: i < dto.seats,
        })),
        offered,
        waitlisted,
      };
    });
    return { seed, ...out };
  }

  /** The next on the waiting list (of a category) is offered the seat. */
  async next(ctx: RequestContext, cycleId: string, dto: SelectionNextDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.lapse(c, cycleId);
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM applications WHERE cycle_id = $1 AND class_id = $2 AND status = 'waitlisted'
            AND ($3::bigint IS NULL OR category_id = $3::bigint) ORDER BY wait_rank NULLS LAST, id LIMIT 1`,
        [cycleId, dto.classId, dto.categoryId ?? null],
      );
      if (!r.rows[0])
        throw new DomainError('admissions.list_empty', 'Nobody is on the waiting list', {
          status: 409,
        });
      await this.offerOne(c, ctx, r.rows[0].id, cycleId);
      return { offered: r.rows[0].id };
    });
  }
}
