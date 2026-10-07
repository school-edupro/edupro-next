import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { UpdateAcademicSettingsDto } from './daily.dto';

export type ContactShow = 'full' | 'masked' | 'hidden';
/** The academics sections that take attachments; each has its own largest file. */
export type UploadSection = 'daily_work' | 'assignment' | 'documents' | 'notices' | 'gallery';

export interface AcademicSettings {
  /** HH:MM: the time of day daily work reaches the families; null = at once. */
  publishTime: string | null;
  teacherMobile: ContactShow;
  teacherEmail: ContactShow;
  maxMb: Record<UploadSection, number>;
}

const SECTION_LABEL: Record<UploadSection, string> = {
  daily_work: 'homework and classwork',
  assignment: 'assignments',
  documents: 'class documents',
  notices: 'notices and office orders',
  gallery: 'the gallery',
};

/** What the school decides for the academics module (0092); a school that never saved has the defaults. */
@Injectable()
export class AcademicSettingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async read(c: PoolClient): Promise<AcademicSettings> {
    const r = await c.query<{
      publish_time: string | null;
      teacher_mobile: ContactShow;
      teacher_email: ContactShow;
      max_mb_daily_work: number;
      max_mb_assignment: number;
      max_mb_documents: number;
      max_mb_notices: number;
      max_mb_gallery: number;
    }>(
      `SELECT to_char(publish_time, 'HH24:MI') AS publish_time, teacher_mobile, teacher_email, max_mb_daily_work,
              max_mb_assignment, max_mb_documents, max_mb_notices, max_mb_gallery
         FROM academic_settings WHERE school_id = app.current_school_id()`,
    );
    const s = r.rows[0];
    return {
      publishTime: s?.publish_time ?? null,
      teacherMobile: s?.teacher_mobile ?? 'masked',
      teacherEmail: s?.teacher_email ?? 'masked',
      maxMb: {
        daily_work: s?.max_mb_daily_work ?? 10,
        assignment: s?.max_mb_assignment ?? 10,
        documents: s?.max_mb_documents ?? 15,
        notices: s?.max_mb_notices ?? 10,
        gallery: s?.max_mb_gallery ?? 10,
      },
    };
  }

  get(ctx: RequestContext): Promise<AcademicSettings> {
    return this.db.tenant(requireTenant(ctx), (c) => this.read(c));
  }

  async update(ctx: RequestContext, dto: UpdateAcademicSettingsDto): Promise<AcademicSettings> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.read(c);
      await c.query(
        `INSERT INTO academic_settings (school_id, publish_time, teacher_mobile, teacher_email, max_mb_daily_work,
                                        max_mb_assignment, max_mb_documents, max_mb_notices, max_mb_gallery, updated_by)
         VALUES (app.current_school_id(), $1::time, $2, $3, $4, $5, $6, $7, $8, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET publish_time = EXCLUDED.publish_time, teacher_mobile = EXCLUDED.teacher_mobile,
           teacher_email = EXCLUDED.teacher_email, max_mb_daily_work = EXCLUDED.max_mb_daily_work,
           max_mb_assignment = EXCLUDED.max_mb_assignment, max_mb_documents = EXCLUDED.max_mb_documents,
           max_mb_notices = EXCLUDED.max_mb_notices, max_mb_gallery = EXCLUDED.max_mb_gallery,
           updated_at = now(), updated_by = app.current_user_id()`,
        [
          dto.publishTime ?? null,
          dto.teacherMobile,
          dto.teacherEmail,
          dto.maxMb.daily_work,
          dto.maxMb.assignment,
          dto.maxMb.documents,
          dto.maxMb.notices,
          dto.maxMb.gallery,
        ],
      );
      const after = await this.read(c);
      await this.audit.stage(ctx, c, {
        action: 'academics.settings.update',
        entityType: 'academic_settings',
        entityId: requireTenant(ctx).schoolId,
        before,
        after,
      });
      return after;
    });
  }

  /** Refuses a file larger than the school allows in this section. */
  async assertSize(
    ctx: RequestContext,
    section: UploadSection,
    files: Array<{ name: string | null; sizeBytes: number }>,
  ): Promise<void> {
    if (!files.length) return;
    const max = (await this.get(ctx)).maxMb[section];
    const big = files.find((f) => f.sizeBytes > max * 1024 * 1024);
    if (big)
      throw new DomainError(
        'file.too_large',
        `${big.name ?? 'The file'} is larger than ${String(max)} MB, the limit the school has set for ${SECTION_LABEL[section]}`,
        { status: 413 },
      );
  }
}

/** 9876543210 → 98XXXXXX10; a short number shows its last two digits only. */
export function maskMobile(v: string | null): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.length <= 4
    ? `${'X'.repeat(Math.max(0, d.length - 2))}${d.slice(-2)}`
    : `${d.slice(0, 2)}${'X'.repeat(d.length - 4)}${d.slice(-2)}`;
}

/** anita.sharma@school.in → an***@school.in */
export function maskEmail(v: string | null): string | null {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec((v ?? '').trim());
  if (!m) return null;
  return `${m[1]!.slice(0, 2)}***@${m[2]!}`;
}
