import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { AdmissionCoreService } from '../admissions/admission-core.service';
import type { AdmissionCandidate } from '../admissions/portal/candidate-signin.service';
import { publicTenant } from '../admissions/public/otp.service';
import type { AnswerBackDto, AskDto, RateAskDto, ReopenAskDto } from './candidate-queries.dto';
import { HelpdeskService } from './helpdesk.service';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * The questions of a family registering for admission (docs/design/43, part 4): "Ask the school" and
 * My queries in the admission portal. They are tickets of the helpdesk's admission desk, raised by the
 * applicant about one of its registrations; the head's owner answers in the Helpdesk, with its clock,
 * escalation, close / reopen and rating. Every query here is checked to be the family's own.
 */
@Injectable()
export class CandidateQueriesService {
  constructor(
    private readonly db: DbService,
    private readonly helpdesk: HelpdeskService,
    private readonly core: AdmissionCoreService,
  ) {}

  private t(cand: AdmissionCandidate) {
    return publicTenant(cand.schoolId);
  }

  /** What the family may ask about: the admission desk's heads and its own registrations. */
  async options(cand: AdmissionCandidate) {
    return this.db.tenant(this.t(cand), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const heads = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM query_categories WHERE desk = 'candidate' AND status = 'active' ORDER BY sort_order, name`,
      );
      const regs = await c.query<{
        id: string;
        number: string | null;
        candidate: string | null;
        class_name: string;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, cl.name AS class_name
           FROM applications a JOIN classes cl ON cl.id = a.class_id
          WHERE a.applicant_id = $1 AND a.status::text NOT IN ('cancelled', 'withdrawn')
          ORDER BY a.created_at DESC`,
        [cand.id],
      );
      return {
        heads: heads.rows,
        registrations: regs.rows.map((r) => ({
          id: r.id,
          number: r.number,
          candidate: r.candidate,
          className: r.class_name,
        })),
      };
    });
  }

  /** The family's questions, newest first; "new answer" when the school wrote since it last looked. */
  async list(cand: AdmissionCandidate) {
    return this.db.tenant(this.t(cand), async (c) => {
      const r = await c.query<{
        id: string;
        number: string;
        subject: string;
        head: string;
        status: string;
        opened_at: Date;
        closed_at: Date | null;
        candidate: string | null;
        class_name: string | null;
        reg_no: string | null;
        last_answer: Date | null;
        unread: boolean;
      }>(
        `SELECT q.id::text, q.number, q.subject, COALESCE(k.name, q.category_code) AS head, q.status::text, q.opened_at, q.closed_at,
                a.candidate_name AS candidate, cl.name AS class_name, a.application_no AS reg_no, ans.at AS last_answer,
                (ans.at IS NOT NULL AND ans.at > COALESCE(rd.read_at, '-infinity'::timestamptz)) AS unread
           FROM parent_queries q
           LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = q.desk AND k.code = q.category_code
           LEFT JOIN applications a ON a.id = q.application_id LEFT JOIN classes cl ON cl.id = a.class_id
           LEFT JOIN LATERAL (SELECT max(x.created_at) AS at FROM query_responses x
                               WHERE x.query_id = q.id AND NOT x.is_internal AND x.author_kind::text <> 'candidate') ans ON true
           LEFT JOIN applicant_inbox_reads rd ON rd.applicant_id = q.applicant_id AND rd.kind = 'query' AND rd.item_id = q.id
          WHERE q.desk = 'candidate' AND q.applicant_id = $1
          ORDER BY q.opened_at DESC, q.id DESC LIMIT 100`,
        [cand.id],
      );
      return {
        unread: r.rows.filter((x) => x.unread).length,
        data: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          subject: x.subject,
          head: x.head,
          status: x.status,
          openedAt: x.opened_at.toISOString(),
          closedAt: iso(x.closed_at),
          lastAnswerAt: iso(x.last_answer),
          unread: x.unread,
          registration: { number: x.reg_no, candidate: x.candidate, className: x.class_name },
        })),
      };
    });
  }

  /** Files the family uploaded for a question: its own registrations' files, ready, PDF or image. */
  private async checkFiles(c: PoolClient, cand: AdmissionCandidate, ids: string[]) {
    if (!ids.length) return;
    const r = await c.query<{ ok: boolean }>(
      `SELECT (f.status = 'ready' AND f.size_bytes <= 5242880 AND f.content_type ~ '^(application/pdf|image/(png|jpeg|webp))$'
               AND f.owner_entity_type = 'application'
               AND f.owner_entity_id IN (SELECT id::text FROM applications WHERE applicant_id = $2)) AS ok
         FROM files f WHERE f.id = ANY($1::bigint[]) AND f.deleted_at IS NULL`,
      [ids, cand.id],
    );
    if (r.rows.length !== new Set(ids).size || r.rows.some((x) => !x.ok))
      throw new DomainError('helpdesk.file_invalid', 'Attach a PDF or a photo of up to 5MB', {
        status: 400,
      });
  }

  async ask(cand: AdmissionCandidate, dto: AskDto) {
    const id = await this.db.tenant(this.t(cand), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const a = await c.query<{ year_id: string }>(
        `SELECT y.academic_year_id::text AS year_id FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id
          WHERE a.id = $1 AND a.applicant_id = $2`,
        [dto.applicationId, cand.id],
      );
      if (!a.rows[0]) throw new DomainError('not-found', 'Registration not found', { status: 404 });
      const head = await c.query(
        `SELECT 1 FROM query_categories WHERE desk = 'candidate' AND code = $1 AND status = 'active'`,
        [dto.categoryCode],
      );
      if (!head.rowCount)
        throw new DomainError('validation-failed', 'Choose what the question is about', {
          status: 400,
          extra: { errors: { categoryCode: 'Choose what the question is about' } },
        });
      await this.checkFiles(c, cand, dto.fileIds);
      const no = await c.query<{ n: string }>(`SELECT app.next_query_no($1) AS n`, [
        a.rows[0].year_id,
      ]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, subject, body, file_ids,
                                     desk, priority, channel, applicant_id, application_id)
         VALUES (app.current_school_id(), $1, $2, 'query', $3, $4, $5, $6::jsonb, 'candidate', 'normal', 'admission_portal', $7, $8)
         RETURNING id::text`,
        [
          a.rows[0].year_id,
          no.rows[0]!.n.replace(/^Q\//, 'A/'),
          dto.categoryCode,
          dto.subject,
          dto.body,
          JSON.stringify(dto.fileIds),
          cand.id,
          dto.applicationId,
        ],
      );
      await this.helpdesk.notifyOwner(c, r.rows[0]!.id, 'new');
      return r.rows[0]!.id;
    });
    return this.get(cand, id);
  }

  private async mine(c: PoolClient, cand: AdmissionCandidate, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Query not found', { status: 404 });
    const r = await c.query<{
      id: string;
      number: string;
      subject: string;
      body: string;
      file_ids: string[];
      head: string;
      status: string;
      opened_at: Date;
      closed_at: Date | null;
      resolution: string | null;
      rating: number | null;
      rating_comment: string | null;
      candidate: string | null;
      class_name: string | null;
      reg_no: string | null;
      reg_id: string | null;
      reopen_days: number;
    }>(
      `SELECT q.id::text, q.number, q.subject, q.body, q.file_ids, COALESCE(k.name, q.category_code) AS head, q.status::text,
              q.opened_at, q.closed_at, q.resolution, q.rating, q.rating_comment,
              a.candidate_name AS candidate, cl.name AS class_name, a.application_no AS reg_no, q.application_id::text AS reg_id,
              COALESCE((SELECT reopen_days FROM helpdesk_settings WHERE school_id = app.current_school_id()), 7) AS reopen_days
         FROM parent_queries q
         LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = q.desk AND k.code = q.category_code
         LEFT JOIN applications a ON a.id = q.application_id LEFT JOIN classes cl ON cl.id = a.class_id
        WHERE q.id = $1 AND q.desk = 'candidate' AND q.applicant_id = $2`,
      [id, cand.id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Query not found', { status: 404 });
    return r.rows[0];
  }

  /** One question with the conversation (no internal notes); opening it marks the answers read. */
  async get(cand: AdmissionCandidate, id: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const q = await this.mine(c, cand, id);
      const replies = await c.query<{
        id: string;
        kind: string;
        author: string | null;
        body: string;
        file_ids: string[];
        at: Date;
      }>(
        `SELECT x.id::text, x.author_kind::text AS kind, x.body, x.file_ids, x.created_at AS at,
                CASE WHEN x.author_kind::text = 'candidate' THEN NULL
                     ELSE COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = x.author_user_id LIMIT 1), 'The school') END AS author
           FROM query_responses x WHERE x.query_id = $1 AND NOT x.is_internal ORDER BY x.created_at, x.id`,
        [id],
      );
      await c.query(
        `INSERT INTO applicant_inbox_reads (school_id, applicant_id, kind, item_id) VALUES (app.current_school_id(), $1, 'query', $2)
         ON CONFLICT (applicant_id, kind, item_id) DO UPDATE SET read_at = now()`,
        [cand.id, id],
      );
      const reopenUntil = q.closed_at
        ? new Date(q.closed_at.getTime() + q.reopen_days * 86_400_000)
        : null;
      return {
        id: q.id,
        number: q.number,
        subject: q.subject,
        body: q.body,
        fileIds: (q.file_ids ?? []).map(String),
        head: q.head,
        status: q.status,
        openedAt: q.opened_at.toISOString(),
        closedAt: iso(q.closed_at),
        resolution: q.resolution,
        rating: q.rating,
        ratingComment: q.rating_comment,
        registration: {
          id: q.reg_id,
          number: q.reg_no,
          candidate: q.candidate,
          className: q.class_name,
        },
        replies: replies.rows.map((x) => ({
          id: x.id,
          fromFamily: x.kind === 'candidate',
          author: x.author,
          body: x.body,
          fileIds: (x.file_ids ?? []).map(String),
          at: x.at.toISOString(),
        })),
        you: {
          canReply: q.status !== 'closed',
          canReopen: q.status === 'closed' && reopenUntil !== null && reopenUntil > new Date(),
          canRate: q.status === 'answered' || q.status === 'closed',
          reopenUntil: iso(reopenUntil),
        },
      };
    });
  }

  /** The family writes again: an answered question goes back to the school (its clock restarts). */
  async answerBack(cand: AdmissionCandidate, id: string, dto: AnswerBackDto) {
    await this.db.tenant(this.t(cand), async (c) => {
      const q = await this.mine(c, cand, id);
      if (q.status === 'closed')
        throw new DomainError(
          'helpdesk.closed',
          'This question is closed; reopen it to write again',
          {
            status: 409,
          },
        );
      await this.checkFiles(c, cand, dto.fileIds);
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_kind, body, file_ids)
         VALUES (app.current_school_id(), $1, 'candidate', $2, $3::jsonb)`,
        [id, dto.body, JSON.stringify(dto.fileIds)],
      );
      await c.query(
        `UPDATE parent_queries SET status = CASE WHEN status = 'answered' THEN 'open'::query_status ELSE status END, updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.helpdesk.notifyOwner(c, id, 'reply', dto.body);
    });
    return this.get(cand, id);
  }

  async reopen(cand: AdmissionCandidate, id: string, dto: ReopenAskDto) {
    await this.db.tenant(this.t(cand), async (c) => {
      const q = await this.mine(c, cand, id);
      const until = q.closed_at ? q.closed_at.getTime() + q.reopen_days * 86_400_000 : 0;
      if (q.status !== 'closed' || until < Date.now())
        throw new DomainError(
          'helpdesk.reopen_window',
          'This question can no longer be reopened; ask a new one',
          { status: 409 },
        );
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_kind, body) VALUES (app.current_school_id(), $1, 'candidate', $2)`,
        [id, `Reopened: ${dto.reason}`],
      );
      await c.query(
        `UPDATE parent_queries SET status = 'open', closed_at = NULL, closed_by = NULL, breached_at = NULL, reopened_count = reopened_count + 1,
                due_at = app.helpdesk_add_hours(now(), app.helpdesk_level_hours(desk, category_code, level, priority)), updated_at = now()
          WHERE id = $1`,
        [id],
      );
      await this.helpdesk.notifyOwner(c, id, 'reopened', dto.reason);
    });
    return this.get(cand, id);
  }

  async rate(cand: AdmissionCandidate, id: string, dto: RateAskDto) {
    await this.db.tenant(this.t(cand), async (c) => {
      const q = await this.mine(c, cand, id);
      if (q.status !== 'answered' && q.status !== 'closed')
        throw new DomainError('helpdesk.not_answered', 'Rate once the school has answered', {
          status: 409,
        });
      await c.query(
        `UPDATE parent_queries SET rating = $2, rating_comment = $3, updated_at = now() WHERE id = $1`,
        [id, dto.rating, dto.comment ?? null],
      );
    });
    return this.get(cand, id);
  }

  /** A file on the family's own question (its own or the school's), for View / Download. */
  async file(cand: AdmissionCandidate, id: string, fileId: string) {
    if (!/^\d{1,18}$/.test(fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.db.tenant(this.t(cand), async (c) => {
      await this.mine(c, cand, id);
      const ok = await c.query<{ name: string | null; type: string }>(
        `SELECT f.original_name AS name, f.content_type AS type FROM files f
          WHERE f.id = $2 AND f.deleted_at IS NULL
            AND (EXISTS (SELECT 1 FROM parent_queries q WHERE q.id = $1 AND q.file_ids ? $2::text)
              OR EXISTS (SELECT 1 FROM query_responses x WHERE x.query_id = $1 AND NOT x.is_internal AND x.file_ids ? $2::text))`,
        [id, fileId],
      );
      if (!ok.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
      const bytes = await this.core.fileBytes(c, fileId);
      if (!bytes) throw new DomainError('not-found', 'File not found', { status: 404 });
      return {
        filename: ok.rows[0].name ?? 'file',
        contentType: ok.rows[0].type,
        base64: bytes.bytes.toString('base64'),
      };
    });
  }
}
