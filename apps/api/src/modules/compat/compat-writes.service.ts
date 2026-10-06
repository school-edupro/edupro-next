import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateDailyWorkDto, CreateNoticeDto } from '../academics/daily/daily.dto';
import { DailyWorkService } from '../academics/daily/daily-work.service';
import { NoticesService } from '../academics/daily/notices.service';
import type { MarkSessionDto } from '../attendance/attendance.dto';
import { AttendanceService } from '../attendance/attendance.service';
import type { LegacyResult } from './compat.service';
import type { NoticeActionDto, UploadAttendanceDto, UploadDailyworkDto } from './compat.dto';

/** Legacy dates arrive as dd/mm/yyyy or yyyy-mm-dd. */
export function legacyDate(v: string | undefined): string {
  if (!v) return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(v.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  throw new DomainError('validation-failed', `Unrecognised date: ${v}`, { status: 400 });
}

const LEGACY_CODES: Record<string, string> = {
  P: 'P',
  A: 'A',
  L: 'L',
  SR: 'SR',
  H: 'H',
  'A.5': 'H',
  HD: 'H',
  OD: 'OD',
  SB: 'SB',
  'STAY BACK': 'SB',
};

/**
 * Compatibility write endpoints (S11): the current teacher app's UploadDailywork, UploadAttendance and
 * notice_actions posts land in the new modules with the same rules as the new apps (scopes, assignments,
 * approvals), and answer with the legacy `{status, info, data}` envelope.
 */
@Injectable()
export class CompatWritesService {
  constructor(
    private readonly db: DbService,
    private readonly dailyWork: DailyWorkService,
    private readonly attendance: AttendanceService,
    private readonly notices: NoticesService,
  ) {}

  /** Resolves "VI-A" to a section of the working year and an optional subject by code or name. */
  private async resolve(ctx: RequestContext, sclass: string, subject?: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const m = /^([A-Za-z0-9]+)\s*[-/ ]\s*([A-Za-z0-9]+)$/.exec(sclass.trim());
      if (!m)
        throw new DomainError('validation-failed', `Class must look like VI-A (got ${sclass})`, {
          status: 400,
        });
      const sec = await c.query<{ id: string }>(
        `SELECT cs.id::text FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE upper(k.code) = upper($1) AND upper(cs.name) = upper($2) AND cs.academic_year_id = $3 AND cs.deleted_at IS NULL`,
        [m[1], m[2], tenant.academicYearId],
      );
      if (!sec.rows[0])
        throw new DomainError('not-found', `Section ${sclass} not found in the working year`, {
          status: 404,
        });
      let subjectId: string | undefined;
      if (subject) {
        const sub = await c.query<{ id: string }>(
          `SELECT id::text FROM subjects WHERE (upper(code) = upper($1) OR lower(name) = lower($1)) AND deleted_at IS NULL LIMIT 1`,
          [subject.trim()],
        );
        subjectId = sub.rows[0]?.id;
      }
      return { classSectionId: sec.rows[0].id, subjectId };
    });
  }

  async uploadDailywork(
    ctx: RequestContext,
    dto: UploadDailyworkDto,
  ): Promise<LegacyResult<{ srno: string }>> {
    const { classSectionId, subjectId } = await this.resolve(ctx, dto.cboClass, dto.cboSubject);
    const kind = (dto.SubmitType ?? 'homework').toLowerCase().includes('class')
      ? 'classwork'
      : 'homework';
    const text = dto.homework ?? dto.classwork ?? dto.txtDescription ?? '';
    const date = legacyDate(dto.txtDate);
    const row = await this.dailyWork.create(ctx, {
      classSectionId,
      subjectId,
      kind,
      title: (dto.txtTitle ?? `${dto.cboSubject ?? kind} · ${date}`).slice(0, 160),
      body: text,
      assignedOn: date,
      dueOn: dto.txtDueDate ? legacyDate(dto.txtDueDate) : undefined,
      fileIds: [],
      ackRequired: false,
    } as CreateDailyWorkDto);
    return {
      status: true,
      info: `${kind === 'homework' ? 'Homework' : 'Classwork'} saved`,
      data: { srno: row.id },
    };
  }

  async uploadAttendance(
    ctx: RequestContext,
    dto: UploadAttendanceDto,
  ): Promise<LegacyResult<{ marked: number; absent: number }>> {
    const { classSectionId, subjectId } = await this.resolve(ctx, dto.cboClass, dto.cboSubject);
    const date = legacyDate(dto.txtDate);
    const rows = dto.attendance ?? [];
    const tenant = requireTenant(ctx);
    const marks = await this.db.tenant(tenant, async (c) => {
      const out: Array<{
        studentId: string;
        code: 'P' | 'A' | 'L' | 'SR' | 'H' | 'OD' | 'SB';
        remarks?: string;
      }> = [];
      for (const r of rows) {
        const st = await c.query<{ id: string }>(
          `SELECT id::text FROM students WHERE admission_no = $1 AND deleted_at IS NULL`,
          [r.sadmission],
        );
        if (!st.rows[0])
          throw new DomainError('not-found', `Unknown admission number ${r.sadmission}`, {
            status: 404,
          });
        const code =
          LEGACY_CODES[
            String(r.attendance ?? 'P')
              .trim()
              .toUpperCase()
          ];
        if (!code)
          throw new DomainError('validation-failed', `Unknown attendance code ${r.attendance}`, {
            status: 400,
          });
        out.push({ studentId: st.rows[0].id, code: code as 'P', remarks: r.remark?.slice(0, 200) });
      }
      return out;
    });
    const session = await this.attendance.mark(ctx, {
      classSectionId,
      date,
      kind: subjectId ? 'subject' : 'day',
      subjectId,
      marks,
    } as MarkSessionDto);
    return {
      status: true,
      info: 'Attendance saved',
      data: { marked: marks.length, absent: session.counts.A ?? 0 },
    };
  }

  async noticeAction(
    ctx: RequestContext,
    dto: NoticeActionDto,
  ): Promise<LegacyResult<{ srno: string }>> {
    if ((dto.action ?? 'add') !== 'add')
      throw new DomainError('validation-failed', 'Only action=add is supported', { status: 400 });
    const targets: Array<{ type: 'class_section'; id: string }> = [];
    const cls = (dto.class ?? dto.sclass ?? '').trim();
    if (cls && cls.toUpperCase() !== 'ALL') {
      const { classSectionId } = await this.resolve(ctx, cls);
      targets.push({ type: 'class_section', id: classSectionId });
    }
    const date = legacyDate(dto.notice_date);
    const row = await this.notices.create(ctx, {
      kind: 'notice',
      title: (dto.notice_title ?? 'Notice').slice(0, 200),
      body: dto.notice ?? '',
      audience: targets.length ? 'students' : 'everyone',
      publishFrom: date,
      isPinned: false,
      targets,
      fileIds: [],
      ackRequired: false,
      bodyFormat: 'text',
      alsoEmail: false,
      publish: true,
    } as CreateNoticeDto);
    return { status: true, info: 'Notice published', data: { srno: row.id } };
  }
}
