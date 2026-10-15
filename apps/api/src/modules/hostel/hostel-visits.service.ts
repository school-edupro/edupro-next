import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import {
  HOSTEL_H3,
  type DecideDto,
  type VisitCheckDto,
  type VisitDecideDto,
  type VisitDto,
  type VisitHoursDto,
  type VisitorAddDto,
  type VisitorsQueryDto,
  type VisitsQueryDto,
} from './hostel.dto';
import { HostelService } from './hostel.service';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A data URL photo as type and bytes; nothing when absent; refused when it is not a small image. */
function photoOf(v?: string): { contentType: string; bytes: Buffer } | null {
  if (!v) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m)
    throw new DomainError('validation-failed', 'The photo must be a JPEG, PNG or WebP image', {
      status: 400,
    });
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length < 100 || bytes.length > 300_000)
    throw new DomainError('validation-failed', 'The photo must be under 300 KB', { status: 400 });
  return { contentType: m[1]!, bytes };
}

/**
 * Hostel module H3, visitors: each boarder's approved-visitor list (parents add, a warden approves, the
 * office adds directly; parents and guardians on record count as approved), the visiting hours of each
 * hostel, and hostel visits on the visitor register — a visitor not on the list or outside the hours waits
 * at the gate for a warden to allow or refuse, and the parent is told.
 */
@Injectable()
export class HostelVisitsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly hostel: HostelService,
  ) {}

  private async family(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
  }

  /** The hostel the pupil holds a bed in today, and whether the user may act for it (a warden: their own). */
  private async hostelOf(ctx: RequestContext, c: PoolClient, studentId: string, mustBeMine = true) {
    const h = (
      await c.query<{ id: string | null; name: string | null }>(
        `SELECT h.id::text, h.name FROM hostels h
          WHERE h.id = app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
        [studentId],
      )
    ).rows[0];
    if (!h?.id)
      throw new DomainError('hostel.not_boarder', 'The pupil holds no hostel bed today', {
        status: 409,
      });
    if (mustBeMine) {
      const only = await this.hostel.scope(ctx, c);
      if (only && !only.includes(h.id))
        throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
          status: 403,
        });
    }
    return { id: h.id, name: h.name! };
  }

  private async school(c: PoolClient) {
    return (
      await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = app.current_school_id()`)
    ).rows[0]?.name;
  }

  // ---- approved-visitor list ---------------------------------------------------------------------------
  /** The list of one pupil: the parents and guardians on record, then the visitors added. */
  private async listOf(c: PoolClient, studentId: string) {
    const record = await c.query<{ name: string; relation: string; mobile: string | null }>(
      `SELECT concat_ws(' ', g.first_name, g.last_name) AS name, sg.relation::text AS relation, g.mobile
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC NULLS LAST, g.id`,
      [studentId],
    );
    const added = await c.query(
      `SELECT v.id::text, v.name, v.relation, v.mobile, v.status, v.source, v.note, v.added_at AS "addedAt",
              v.decided_at AS "decidedAt", EXISTS (SELECT 1 FROM hostel_visitor_photos p WHERE p.visitor_id = v.id) AS "hasPhoto"
         FROM hostel_visitors v WHERE v.student_id = $1 AND v.status <> 'removed' ORDER BY v.status, v.name`,
      [studentId],
    );
    return { onRecord: record.rows, visitors: added.rows };
  }

  async familyList(ctx: RequestContext, studentId: string) {
    await this.family(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), (c) => this.listOf(c, studentId));
  }

  private async add(
    ctx: RequestContext,
    c: PoolClient,
    dto: VisitorAddDto,
    source: 'parent' | 'office',
  ) {
    const photo = photoOf(dto.photo);
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO hostel_visitors (school_id, student_id, name, relation, mobile, status, source, added_by, decided_by, decided_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(),
                 CASE WHEN $5 = 'approved' THEN app.current_user_id() END, CASE WHEN $5 = 'approved' THEN now() END)
         RETURNING id::text`,
        [
          dto.studentId,
          dto.name,
          dto.relation,
          dto.mobile,
          source === 'office' ? 'approved' : 'pending',
          source,
        ],
      );
      const id = r.rows[0]!.id;
      if (photo)
        await c.query(
          `INSERT INTO hostel_visitor_photos (visitor_id, school_id, content_type, bytes) VALUES ($1, app.current_school_id(), $2, $3)`,
          [id, photo.contentType, photo.bytes],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.visitor.add',
        entityType: 'hostel_visitor',
        entityId: id,
        after: { ...dto, photo: photo ? 'yes' : 'no', source },
      });
      return { id, status: source === 'office' ? 'approved' : 'pending' };
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new DomainError(
          'hostel.visitor_listed',
          'This mobile is already on the pupil’s list',
          { status: 409 },
        );
      throw e;
    }
  }

  async familyAdd(ctx: RequestContext, dto: VisitorAddDto) {
    await this.family(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.hostelOf(ctx, c, dto.studentId, false);
      return this.add(ctx, c, dto, 'parent');
    });
  }

  async familyRemove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = (
        await c.query<{ student_id: string }>(
          `SELECT student_id::text FROM hostel_visitors WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!v) throw new DomainError('not-found', 'Visitor not found', { status: 404 });
      await this.family(ctx, v.student_id);
      await c.query(`UPDATE hostel_visitors SET status = 'removed' WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'hostel.visitor.remove',
        entityType: 'hostel_visitor',
        entityId: id,
      });
      return { ok: true };
    });
  }

  async officeAdd(ctx: RequestContext, dto: VisitorAddDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.hostelOf(ctx, c, dto.studentId);
      return this.add(ctx, c, dto, 'office');
    });
  }

  async visitors(ctx: RequestContext, q: VisitorsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT v.id::text, v.student_id::text AS "studentId", s.display_name AS pupil, s.admission_no AS "admissionNo",
                h.id::text AS "hostelId", h.name AS hostel, v.name, v.relation, v.mobile, v.status, v.source, v.note,
                v.added_at AS "addedAt", EXISTS (SELECT 1 FROM hostel_visitor_photos p WHERE p.visitor_id = v.id) AS "hasPhoto"
           FROM hostel_visitors v JOIN students s ON s.id = v.student_id
           LEFT JOIN hostels h ON h.id = app.hostel_of(v.student_id, (now() AT TIME ZONE 'Asia/Kolkata')::date)
          WHERE v.status <> 'removed' AND ($1 = 'all' OR v.status = $1)
            AND ($2::bigint IS NULL OR v.student_id = $2) AND ($3::bigint IS NULL OR h.id = $3)
            AND ($4::bigint[] IS NULL OR h.id = ANY ($4::bigint[]))
          ORDER BY v.added_at DESC LIMIT 500`,
        [q.status, q.studentId ?? null, q.hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  async decideVisitor(ctx: RequestContext, id: string, dto: DecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = (
        await c.query<{ student_id: string; status: string }>(
          `SELECT student_id::text, status FROM hostel_visitors WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!v) throw new DomainError('not-found', 'Visitor not found', { status: 404 });
      if (v.status !== 'pending')
        throw new DomainError('conflict', 'This visitor is already decided', { status: 409 });
      await this.hostelOf(ctx, c, v.student_id);
      await c.query(
        `UPDATE hostel_visitors SET status = $2, note = $3, decided_by = app.current_user_id(), decided_at = now() WHERE id = $1`,
        [id, dto.outcome, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.visitor.decide',
        entityType: 'hostel_visitor',
        entityId: id,
        after: dto,
      });
      return { id, status: dto.outcome };
    });
  }

  async photo(ctx: RequestContext, id: string, family: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ student_id: string; content_type: string; bytes: Buffer }>(
          `SELECT v.student_id::text, p.content_type, p.bytes FROM hostel_visitor_photos p JOIN hostel_visitors v ON v.id = p.visitor_id
            WHERE p.visitor_id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) throw new DomainError('not-found', 'No photo', { status: 404 });
      if (family) await this.family(ctx, r.student_id);
      return { contentType: r.content_type, bytes: r.bytes };
    });
  }

  // ---- visiting hours ------------------------------------------------------------------------------------
  async hours(ctx: RequestContext, hostelId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => this.hoursOf(c, hostelId));
  }

  private async hoursOf(c: PoolClient, hostelId: string) {
    const r = await c.query<{ weekday: number; from: string; to: string }>(
      `SELECT weekday, to_char(from_time, 'HH24:MI') AS "from", to_char(to_time, 'HH24:MI') AS "to"
         FROM hostel_visit_hours WHERE hostel_id = $1 ORDER BY weekday, from_time`,
      [hostelId],
    );
    return r.rows;
  }

  async saveHours(ctx: RequestContext, hostelId: string, dto: VisitHoursDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`DELETE FROM hostel_visit_hours WHERE hostel_id = $1`, [hostelId]);
      for (const h of dto.hours)
        await c.query(
          `INSERT INTO hostel_visit_hours (school_id, hostel_id, weekday, from_time, to_time)
           VALUES (app.current_school_id(), $1, $2, $3::time, $4::time) ON CONFLICT DO NOTHING`,
          [hostelId, h.weekday, h.from, h.to],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.visit_hours.save',
        entityType: 'hostel',
        entityId: hostelId,
        after: dto,
      });
      return { hours: await this.hoursOf(c, hostelId) };
    });
  }

  private hoursText = (rows: Array<{ weekday: number; from: string; to: string }>) =>
    rows.length ? rows.map((h) => `${DAYS[h.weekday]} ${h.from}–${h.to}`).join(', ') : 'Any time';

  // ---- at the gate --------------------------------------------------------------------------------------
  /** Boarders by name or admission no., with their hostel and room (the gate's search). */
  async boarders(ctx: RequestContext, q: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT s.id::text, s.display_name AS name, s.admission_no AS "admissionNo", h.name AS hostel, r.room_no AS room
           FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
           JOIN hostels h ON h.id = r.hostel_id JOIN students s ON s.id = a.student_id
          WHERE a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
            AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
            AND s.search_text LIKE '%' || app.search_text($1) || '%'
          ORDER BY s.display_name LIMIT 20`,
        [q],
      );
      return r.rows;
    });
  }

  /** What the gate sees for a pupil (and a visitor's mobile): the hostel, the list, the hours. */
  async check(ctx: RequestContext, q: VisitCheckDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.hostelOf(ctx, c, q.studentId, false);
      const pupil = (
        await c.query<{ name: string; admission_no: string }>(
          `SELECT display_name AS name, admission_no FROM students WHERE id = $1`,
          [q.studentId],
        )
      ).rows[0]!;
      const list = await this.listOf(c, q.studentId);
      const hours = await this.hoursOf(c, h.id);
      const inHours = (
        await c.query<{ ok: boolean }>(`SELECT app.hostel_in_visit_hours($1) AS ok`, [h.id])
      ).rows[0]!.ok;
      const match = q.mobile
        ? (list.onRecord.find((g) => g.mobile === q.mobile) ??
          (list.visitors as Array<{ mobile: string; status: string }>).find(
            (v) => v.mobile === q.mobile && v.status === 'approved',
          ) ??
          null)
        : null;
      return {
        pupil: { id: q.studentId, name: pupil.name, admissionNo: pupil.admission_no },
        hostel: h,
        inHours,
        hours: this.hoursText(hours),
        listed: !!match,
        match,
        list: {
          onRecord: list.onRecord,
          approved: (list.visitors as Array<{ status: string }>).filter(
            (v) => v.status === 'approved',
          ),
        },
      };
    });
  }

  /** Register a hostel visitor at the gate: let in when listed and within hours, else wait for the warden. */
  async register(ctx: RequestContext, dto: VisitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.hostelOf(ctx, c, dto.studentId, false);
      const pupil = (
        await c.query<{ name: string }>(`SELECT display_name AS name FROM students WHERE id = $1`, [
          dto.studentId,
        ])
      ).rows[0]!;
      const listed = await c.query<{ visitor_id: string | null; record: boolean }>(
        `SELECT (SELECT v.id::text FROM hostel_visitors v WHERE v.student_id = $1 AND v.mobile = $2 AND v.status = 'approved' LIMIT 1) AS visitor_id,
                EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                         WHERE sg.student_id = $1 AND right(regexp_replace(g.mobile, '\\D', '', 'g'), 10) = $2) AS record`,
        [dto.studentId, dto.mobile],
      );
      const isListed = !!listed.rows[0]?.visitor_id || !!listed.rows[0]?.record;
      const inHours = (
        await c.query<{ ok: boolean }>(`SELECT app.hostel_in_visit_hours($1) AS ok`, [h.id])
      ).rows[0]!.ok;
      const state = isListed && inHours ? 'inside' : 'waiting';
      const photo = photoOf(dto.photo);
      const r = await c.query<{ id: string; number: string }>(
        `INSERT INTO visitor_log (school_id, source, state, visitor_name, mobile, visitor_type, party_size, id_proof_kind, id_proof_last4,
                purpose, to_meet, gate, logged_by, student_id, hostel_id, hostel_visitor_id, hostel_listed, hostel_in_hours)
         VALUES (app.current_school_id(), 'gate', $1, $2, $3, 'Hostel visitor', $4, $5, $6, $7, $8, $9, app.current_user_id(),
                 $10, $11, $12, $13, $14)
         RETURNING id::text, number`,
        [
          state,
          dto.visitorName,
          dto.mobile,
          dto.partySize,
          dto.idProofKind ?? null,
          dto.idProofLast4?.toUpperCase() ?? null,
          `Hostel visit (${dto.relation})`,
          pupil.name,
          dto.gate ?? null,
          dto.studentId,
          h.id,
          listed.rows[0]?.visitor_id ?? null,
          isListed,
          inHours,
        ],
      );
      const row = r.rows[0]!;
      if (photo)
        await c.query(
          `INSERT INTO visitor_photos (visitor_log_id, school_id, content_type, bytes) VALUES ($1, app.current_school_id(), $2, $3)`,
          [row.id, photo.contentType, photo.bytes],
        );
      const why = [
        isListed ? null : 'not on the approved list',
        inHours ? null : 'outside visiting hours',
      ]
        .filter(Boolean)
        .join(' and ');
      const vars = {
        visitor: dto.visitorName,
        relation: dto.relation,
        who: pupil.name,
        hostel: h.name,
        why,
        school: (await this.school(c)) ?? '',
      };
      if (state === 'waiting')
        await c.query(
          `SELECT app.template_to_users('hostel_visit_waiting', app.hostel_warden_users($1::bigint), $2::jsonb)`,
          [h.id, JSON.stringify(vars)],
        );
      else await this.tellParent(c, dto.studentId, { ...vars, outcome: 'let in' });
      await this.audit.stage(ctx, c, {
        action: 'hostel.visit.register',
        entityType: 'visitor_log',
        entityId: row.id,
        after: { ...dto, photo: photo ? 'yes' : 'no', state, listed: isListed, inHours },
      });
      return { id: row.id, number: row.number, state, listed: isListed, inHours, why: why || null };
    });
  }

  private async tellParent(c: PoolClient, studentId: string, vars: Record<string, string>) {
    const time = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
    await c.query(
      `SELECT app.template_to_mobiles('hostel_visit_parent', ARRAY(
          SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
           WHERE sg.student_id = $1 AND sg.receives_notifications AND g.mobile IS NOT NULL), $2::jsonb)`,
      [studentId, JSON.stringify({ ...vars, time })],
    );
  }

  /** A warden allows or refuses a waiting visit; the parent is told. */
  async decideVisit(ctx: RequestContext, id: string, dto: VisitDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = (
        await c.query<{
          state: string;
          student_id: string | null;
          visitor_name: string;
          purpose: string;
          hostel_id: string | null;
        }>(
          `SELECT state, student_id::text, visitor_name, purpose, hostel_id::text FROM visitor_log WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!v?.student_id || !v.hostel_id)
        throw new DomainError('not-found', 'Hostel visit not found', { status: 404 });
      if (v.state !== 'waiting')
        throw new DomainError('conflict', 'This visit is not waiting', { status: 409 });
      const only = await this.hostel.scope(ctx, c);
      if (only && !only.includes(v.hostel_id))
        throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
          status: 403,
        });
      const allowed = dto.outcome === 'allowed';
      await c.query(
        `UPDATE visitor_log SET state = $2, in_at = CASE WHEN $2 = 'inside' THEN now() ELSE in_at END,
                warden_decision = $3, warden_by = app.current_user_id(), warden_at = now(), warden_note = $4
          WHERE id = $1`,
        [id, allowed ? 'inside' : 'cancelled', dto.outcome, dto.note ?? null],
      );
      const h = (
        await c.query<{ name: string }>(`SELECT name FROM hostels WHERE id = $1`, [v.hostel_id])
      ).rows[0]!;
      const pupil = (
        await c.query<{ name: string }>(`SELECT display_name AS name FROM students WHERE id = $1`, [
          v.student_id,
        ])
      ).rows[0]!;
      await this.tellParent(c, v.student_id, {
        visitor: v.visitor_name,
        relation: v.purpose.replace(/^Hostel visit \((.*)\)$/, '$1'),
        who: pupil.name,
        hostel: h.name,
        outcome: allowed ? 'let in by the warden' : 'not allowed by the warden',
        school: (await this.school(c)) ?? '',
      });
      await this.audit.stage(ctx, c, {
        action: 'hostel.visit.decide',
        entityType: 'visitor_log',
        entityId: id,
        after: dto,
      });
      return { id, state: allowed ? 'inside' : 'cancelled' };
    });
  }

  async visits(ctx: RequestContext, q: VisitsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const where: Record<VisitsQueryDto['show'], string> = {
        waiting: `v.state = 'waiting'`,
        inside: `v.state = 'inside'`,
        today: `(v.created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
        all: `true`,
      };
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the filter is one of the fixed strings above; values bound
        `SELECT v.id::text, v.number, v.state, v.visitor_name AS "visitorName", v.mobile, v.purpose, v.party_size AS "partySize",
                v.student_id::text AS "studentId", s.display_name AS pupil, s.admission_no AS "admissionNo", h.name AS hostel,
                v.hostel_listed AS listed, v.hostel_in_hours AS "inHours", v.warden_decision AS "wardenDecision",
                v.warden_note AS "wardenNote", v.created_at AS "createdAt", v.in_at AS "inAt", v.out_at AS "outAt",
                EXISTS (SELECT 1 FROM visitor_photos p WHERE p.visitor_log_id = v.id) AS "hasPhoto"
           FROM visitor_log v JOIN students s ON s.id = v.student_id JOIN hostels h ON h.id = v.hostel_id
          WHERE v.hostel_id IS NOT NULL AND ${where[q.show]}
            AND ($1::bigint IS NULL OR v.hostel_id = $1) AND ($2::bigint[] IS NULL OR v.hostel_id = ANY ($2::bigint[]))
          ORDER BY v.created_at DESC LIMIT 500`,
        [q.hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  /** The photo taken at the gate, for the warden deciding a waiting visit. */
  async visitPhoto(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ hostel_id: string | null; content_type: string; bytes: Buffer }>(
          `SELECT v.hostel_id::text, p.content_type, p.bytes FROM visitor_photos p JOIN visitor_log v ON v.id = p.visitor_log_id
            WHERE p.visitor_log_id = $1`,
          [id],
        )
      ).rows[0];
      if (!r?.hostel_id) throw new DomainError('not-found', 'No photo', { status: 404 });
      const only = await this.hostel.scope(ctx, c);
      if (only && !only.includes(r.hostel_id))
        throw new DomainError('not-found', 'No photo', { status: 404 });
      return { contentType: r.content_type, bytes: r.bytes };
    });
  }
}
