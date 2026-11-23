import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AREA_WORDS, areaEntries, type EntryArea } from './area-entry';
import { reopenImpact, takeBackCards } from './exam-reopen';
import { ExamEntryService } from './exam-entry.service';
import { EXAMS, type CloseAreaEntryDto, type OpenAreaEntryDto } from './exams.dto';

const DAY = 24 * 60 * 60 * 1000;

/**
 * docs/design/98 (asked 23 Nov 2026): while the whole exam (or a class's lock of an area) stays locked, the school
 * admin reopens ONE section's indicators, remarks, exam attendance or height and weight for entry, with a reason and
 * a closing date-time (two days unless set). The people who normally enter that area there enter again (the class
 * teacher; teachers given indicator areas; a subject's remark category its subject teacher); it closes on the
 * class teacher's Done, the admin's Close now, a lock change or the date. As the marks' one-sheet reopen, the
 * class's published report card is taken back.
 */
@Injectable()
export class AreaEntryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly entry: ExamEntryService,
  ) {}

  async open(ctx: RequestContext, examId: string, dto: OpenAreaEntryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const section = await this.entry.section(c, dto.classSectionId, yearId, examId);
      const takes = await c.query<{ on: boolean }>(
        `SELECT $2 = ANY(areas) AS on FROM exams WHERE id = $1`,
        [examId, dto.area],
      );
      if (!takes.rows[0]?.on)
        throw new DomainError(
          'exams.area_off',
          `This exam does not take ${AREA_WORDS[dto.area].toLowerCase()}`,
          { status: 409 },
        );
      const state = (await areaEntries(c, examId, section.id, section.class_id))[dto.area];
      if (!state.locks.exam && !state.locks.class)
        throw new DomainError(
          'exams.entry_open',
          `${AREA_WORDS[dto.area]} of ${section.code} is not locked: it is open for entry already`,
          { status: 409 },
        );
      if (state.open)
        throw new DomainError(
          'exams.entry_open',
          `${AREA_WORDS[dto.area]} of ${section.code} is open for entry already`,
          { status: 409, extra: { until: state.open.until } },
        );
      const now = Date.now();
      const closes = dto.closesAt ? new Date(dto.closesAt) : new Date(now + 2 * DAY);
      if (closes.getTime() < now + 5 * 60 * 1000 || closes.getTime() > now + 30 * DAY)
        throw new DomainError(
          'validation-failed',
          'Pick a closing time from a few minutes to 30 days ahead',
          {
            status: 400,
            extra: {
              errors: [
                {
                  path: 'closesAt',
                  message: 'Pick a closing time from a few minutes to 30 days ahead',
                },
              ],
            },
          },
        );
      const cards = (await reopenImpact(c, examId, section.class_id)).some((x) => x.cards.length);
      if (cards && !ctx.permissions?.has(EXAMS.resultPublish))
        throw new DomainError(
          'permission-denied',
          'Taking a published card back needs exams.result.publish',
          { status: 403 },
        );
      const revoked = cards ? await takeBackCards(c, examId, section.class_id, dto.note) : [];
      // a lapsed opening of the same section's area is history now (the one-open-row index)
      await c.query(
        `UPDATE exam_area_entry_opens SET closed_at = closes_at, closed_how = 'lapsed'
          WHERE exam_id = $1 AND class_section_id = $2 AND area = $3 AND closed_at IS NULL AND closes_at <= now()`,
        [examId, section.id, dto.area],
      );
      const ins = await c.query<{ id: string }>(
        `INSERT INTO exam_area_entry_opens (school_id, exam_id, class_section_id, area, reason, opened_by, closes_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5) RETURNING id::text`,
        [examId, section.id, dto.area, dto.note, closes],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.area.open_entry',
        entityType: 'exam_area_entry_opens',
        entityId: ins.rows[0]!.id,
        after: {
          examId,
          classSectionId: section.id,
          area: dto.area,
          reason: dto.note,
          closesAt: closes.toISOString(),
          revoked,
        },
      });
      const entry = (await areaEntries(c, examId, section.id, section.class_id))[dto.area];
      return { area: dto.area, section: section.code, entry, revoked };
    });
  }

  /** the class teacher's Done (or the admin's Close now): the section's area is locked again */
  async close(ctx: RequestContext, examId: string, dto: CloseAreaEntryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const section = await this.entry.section(c, dto.classSectionId, yearId, examId);
      if (!(await this.entry.mayCloseArea(c, tenant, ctx, yearId, section.id, dto.area)))
        throw new DomainError(
          'permission-denied',
          'Only the class teacher of the section (or the school admin) closes it',
          { status: 403 },
        );
      const how = ctx.permissions?.has(EXAMS.lockManage) ? 'admin' : 'done';
      const r = await c.query<{ id: string }>(
        `UPDATE exam_area_entry_opens SET closed_at = now(), closed_by = app.current_user_id(), closed_how = $4, close_note = $5
          WHERE exam_id = $1 AND class_section_id = $2 AND area = $3 AND closed_at IS NULL AND closes_at > now()
          RETURNING id::text`,
        [examId, section.id, dto.area, how, dto.note?.trim() || null],
      );
      if (!r.rows[0])
        throw new DomainError(
          'exams.entry_not_open',
          `${AREA_WORDS[dto.area]} of ${section.code} is not open for entry`,
          { status: 409 },
        );
      await this.audit.stage(ctx, c, {
        action: 'exams.area.close_entry',
        entityType: 'exam_area_entry_opens',
        entityId: r.rows[0].id,
        after: { examId, classSectionId: section.id, area: dto.area, how },
      });
      const entry = (await areaEntries(c, examId, section.id, section.class_id))[dto.area];
      return { area: dto.area, section: section.code, entry };
    });
  }

  /** the exam's openings: open now first, then the last closed or lapsed ones (the admin's Status page) */
  async list(ctx: RequestContext, examId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const r = await c.query<{
        id: string;
        section_id: string;
        class_id: string;
        section: string;
        area: EntryArea;
        reason: string;
        opened_by: string | null;
        opened_at: Date;
        closes_at: Date;
        closed_at: Date | null;
        closed_how: string | null;
        closed_by: string | null;
        open: boolean;
      }>(
        `SELECT o.id::text, o.class_section_id::text AS section_id, cs.class_id::text, k.code || '-' || cs.name AS section,
                o.area, o.reason, ou.display_name AS opened_by, o.opened_at, o.closes_at, o.closed_at,
                CASE WHEN o.closed_at IS NULL AND o.closes_at <= now() THEN 'lapsed' ELSE o.closed_how END AS closed_how,
                cu.display_name AS closed_by, (o.closed_at IS NULL AND o.closes_at > now()) AS open
           FROM exam_area_entry_opens o
           JOIN class_sections cs ON cs.id = o.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN users ou ON ou.id = o.opened_by LEFT JOIN users cu ON cu.id = o.closed_by
          WHERE o.exam_id = $1
          ORDER BY (o.closed_at IS NULL AND o.closes_at > now()) DESC, o.opened_at DESC
          LIMIT 100`,
        [examId],
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          classSectionId: x.section_id,
          classId: x.class_id,
          section: x.section,
          area: x.area,
          reason: x.reason,
          openedBy: x.opened_by,
          openedAt: x.opened_at.toISOString(),
          until: x.closes_at.toISOString(),
          open: x.open,
          closedAt: x.closed_at
            ? x.closed_at.toISOString()
            : x.open
              ? null
              : x.closes_at.toISOString(),
          closedHow: x.closed_how,
          closedBy: x.closed_by,
        })),
      };
    });
  }
}
