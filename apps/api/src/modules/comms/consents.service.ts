import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { ConsentQueryDto, RecordConsentDto, SelfConsentDto } from './comms.dto';

/** DPDP consent purposes every school starts with; the wording is versioned so a change asks again. */
export const DEFAULT_PURPOSES: Array<{
  code: string;
  name: string;
  description: string;
  channel: 'sms' | 'whatsapp' | 'email' | null;
  required: boolean;
}> = [
  {
    code: 'comms.sms',
    name: 'SMS updates',
    description:
      'General circulars and event information by SMS. Fee, attendance and safety messages are sent regardless.',
    channel: 'sms',
    required: false,
  },
  {
    code: 'comms.whatsapp',
    name: 'WhatsApp updates',
    description: 'General circulars, homework reminders and event information on WhatsApp.',
    channel: 'whatsapp',
    required: false,
  },
  {
    code: 'comms.email',
    name: 'Email newsletters',
    description: 'Newsletters, circulars and event information by email.',
    channel: 'email',
    required: false,
  },
  {
    code: 'media.gallery',
    name: 'Photographs in the school gallery',
    description:
      'Photographs of my child from school events may appear in the school gallery and app.',
    channel: null,
    required: false,
  },
  {
    code: 'transport.tracking',
    name: 'Bus boarding alerts and location sharing',
    description:
      'Boarding and alighting alerts and the live location of the school bus my child travels in.',
    channel: null,
    required: false,
  },
  {
    code: 'ai.assistant',
    name: 'AI assistant in the parent app',
    description:
      'The school assistant may answer my questions using my child’s attendance, homework, fee and notice records. Answers are generated from school data only; nothing is used to train models.',
    channel: null,
    required: false,
  },
];

export interface PurposeStatus {
  code: string;
  name: string;
  description: string;
  channel: string | null;
  isRequired: boolean;
  version: number;
  status: 'granted' | 'withdrawn' | null;
  recordedAt: string | null;
  source: string | null;
}

@Injectable()
export class ConsentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async installDefaults(c: PoolClient): Promise<void> {
    for (const [i, p] of DEFAULT_PURPOSES.entries())
      await c.query(
        `INSERT INTO consent_purposes (school_id, code, name, description, channel, is_required, sort_order)
         VALUES (app.current_school_id(), $1, $2, $3, $4::comms_channel, $5, $6) ON CONFLICT (school_id, code) DO NOTHING`,
        [p.code, p.name, p.description, p.channel, p.required, i],
      );
  }

  /** Purposes with the current status of one user (the latest consent row per purpose). */
  async statusFor(c: PoolClient, userId: string): Promise<PurposeStatus[]> {
    const r = await c.query<{
      code: string;
      name: string;
      description: string;
      channel: string | null;
      is_required: boolean;
      version: number;
      status: 'granted' | 'withdrawn' | null;
      recorded_at: Date | null;
      source: string | null;
    }>(
      `SELECT p.code, p.name, p.description, p.channel::text, p.is_required, p.version, l.status::text AS status, l.recorded_at, l.source
         FROM consent_purposes p
         LEFT JOIN LATERAL (SELECT status, recorded_at, source FROM consents x WHERE x.user_id = $1 AND x.purpose_code = p.code ORDER BY x.recorded_at DESC, x.id DESC LIMIT 1) l ON true
        ORDER BY p.sort_order, p.code`,
      [userId],
    );
    return r.rows.map((x) => ({
      code: x.code,
      name: x.name,
      description: x.description,
      channel: x.channel,
      isRequired: x.is_required,
      version: x.version,
      status: x.status,
      recordedAt: x.recorded_at ? x.recorded_at.toISOString() : null,
      source: x.source,
    }));
  }

  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.installDefaults(c);
      return { purposes: await this.statusFor(c, ctx.user.id) };
    });
  }

  async recordSelf(ctx: RequestContext, dto: SelfConsentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.installDefaults(c);
      const p = await c.query<{ is_required: boolean; version: number }>(
        `SELECT is_required, version FROM consent_purposes WHERE code = $1`,
        [dto.purposeCode],
      );
      if (!p.rows[0]) throw new DomainError('not-found', 'Unknown purpose', { status: 404 });
      if (p.rows[0].is_required && dto.status === 'withdrawn')
        throw new DomainError(
          'consent.required',
          'This purpose is required for the service and cannot be withdrawn in the app',
          { status: 409 },
        );
      await c.query(
        `INSERT INTO consents (school_id, user_id, purpose_code, status, version, source, recorded_by) VALUES (app.current_school_id(), app.current_user_id(), $1, $2::consent_status, $3, 'parent_app', app.current_user_id())`,
        [dto.purposeCode, dto.status, p.rows[0].version],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.consent.self',
        entityType: 'consents',
        entityId: ctx.user.id,
        after: { purpose: dto.purposeCode, status: dto.status },
      });
      return { purposes: await this.statusFor(c, ctx.user.id) };
    });
  }

  /** Office view: the current status and history of one user. */
  async forUser(ctx: RequestContext, q: ConsentQueryDto) {
    const userId = q.userId;
    if (!userId) throw new DomainError('validation-failed', 'userId is required', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.installDefaults(c);
      const u = await c.query<{ id: string; name: string }>(
        `SELECT u.id::text, u.display_name AS name FROM users u JOIN user_school_memberships m ON m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL WHERE u.id = $1`,
        [userId],
      );
      if (!u.rows[0]) throw new DomainError('not-found', 'Member not found', { status: 404 });
      const history = await c.query<{
        id: string;
        purpose_code: string;
        status: string;
        source: string;
        note: string | null;
        recorded_by: string | null;
        recorded_at: Date;
      }>(
        `SELECT x.id::text, x.purpose_code, x.status::text, x.source, x.note, r.display_name AS recorded_by, x.recorded_at
           FROM consents x LEFT JOIN users r ON r.id = x.recorded_by WHERE x.user_id = $1 ORDER BY x.recorded_at DESC LIMIT 100`,
        [userId],
      );
      return {
        user: u.rows[0],
        purposes: await this.statusFor(c, userId),
        history: history.rows.map((h) => ({
          id: h.id,
          purposeCode: h.purpose_code,
          status: h.status,
          source: h.source,
          note: h.note,
          recordedBy: h.recorded_by,
          recordedAt: h.recorded_at.toISOString(),
        })),
      };
    });
  }

  /** Office recording on behalf of a person (signed form at the counter). */
  async record(ctx: RequestContext, dto: RecordConsentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.installDefaults(c);
      const p = await c.query<{ version: number }>(
        `SELECT version FROM consent_purposes WHERE code = $1`,
        [dto.purposeCode],
      );
      if (!p.rows[0]) throw new DomainError('not-found', 'Unknown purpose', { status: 404 });
      await c.query(
        `INSERT INTO consents (school_id, user_id, student_id, purpose_code, status, version, source, note, recorded_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::consent_status, $5, 'office', $6, app.current_user_id())`,
        [
          dto.userId,
          dto.studentId ?? null,
          dto.purposeCode,
          dto.status,
          p.rows[0].version,
          dto.note ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.consent.record',
        entityType: 'consents',
        entityId: dto.userId,
        after: { purpose: dto.purposeCode, status: dto.status, note: dto.note ?? null },
      });
      return this.forUser(ctx, { userId: dto.userId });
    });
  }
}
