import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { SendMessageDto } from '../comms/comms.dto';
import { MessagesService } from '../comms/messages.service';
import type { PoolClient } from '@edupro/db';
import type { NotifyDefaultersDto } from './fees.dto';

/** The migration installs `fee_due` for the schools that existed then; later schools get it on first use. */
export async function ensureFeeDueTemplates(c: PoolClient): Promise<void> {
  await c.query(
    `INSERT INTO comms_templates (school_id, code, channel, name, body, variables)
     VALUES
       (app.current_school_id(), 'fee_due', 'whatsapp', 'Fee reminder',
        'Dear {{guardian_name}}, fees of ₹{{amount}} for {{student_name}} ({{section}}) are pending as on {{as_of}}. Please pay at the school counter or in the parent app. - {{school}}',
        '["guardian_name","amount","student_name","section","as_of","school"]'::jsonb),
       (app.current_school_id(), 'fee_due', 'sms', 'Fee reminder',
        'Dear {{guardian_name}}, fees of Rs {{amount}} for {{student_name}} are pending as on {{as_of}}. - {{school}}',
        '["guardian_name","amount","student_name","as_of","school"]'::jsonb)
     ON CONFLICT (school_id, code, channel) DO NOTHING`,
  );
}

export interface NotifyResult {
  sent: number;
  skippedToday: number;
  noMobile: number;
  noBalance: number;
  failed: number;
}

/**
 * Sprint 15: the reports centre's one write — fee reminders to defaulters. The list itself is the
 * `fee_defaulters` dataset (mart.fee_dues); this sends the `fee_due` template to the primary guardian of
 * each selected student, once per student per day, and records it in fee_reminders.
 */
@Injectable()
export class FeeReportsService {
  private readonly logger = new Logger(FeeReportsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  async notifyDefaulters(ctx: RequestContext, dto: NotifyDefaultersDto): Promise<NotifyResult> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const yearId = tenant.academicYearId;
    const asOf = dto.asOf ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const targets = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        student_id: string;
        student: string;
        section: string | null;
        balance: string;
        guardian_name: string | null;
        mobile: string | null;
        reminded_today: boolean;
        school: string;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS student, k.code || '-' || cs.name AS section,
                COALESCE((SELECT sum(d.balance) FROM mart.fee_dues d WHERE d.student_id = s.id AND d.academic_year_id = $2 AND d.balance > 0 AND d.due_on < $3::date), 0)::text AS balance,
                g.display_name AS guardian_name, g.mobile,
                EXISTS (SELECT 1 FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.sent_on = CURRENT_DATE) AS reminded_today,
                (SELECT name FROM schools WHERE id = app.current_school_id()) AS school
           FROM students s
           LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
           LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
           LEFT JOIN LATERAL (SELECT g.display_name, g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                               WHERE sg.student_id = s.id AND sg.receives_notifications AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) g ON true
          WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL`,
        [dto.studentIds, yearId, asOf],
      );
      return r.rows;
    });
    const out: NotifyResult = { sent: 0, skippedToday: 0, noMobile: 0, noBalance: 0, failed: 0 };
    for (const t of targets) {
      const balance = Number(t.balance);
      if (balance <= 0) {
        out.noBalance += 1;
        continue;
      }
      if (t.reminded_today) {
        out.skippedToday += 1;
        continue;
      }
      if (!t.mobile) {
        out.noMobile += 1;
        continue;
      }
      try {
        await this.db.tenant(tenant, async (c) => {
          await ensureFeeDueTemplates(c);
          const row = await this.messages.sendWith(c, ctx, {
            templateCode: 'fee_due',
            channel: dto.channel,
            recipientAddress: t.mobile,
            variables: {
              guardian_name: t.guardian_name ?? 'Parent',
              amount: balance.toFixed(2),
              student_name: t.student,
              section: t.section ?? '',
              as_of: asOf,
              school: t.school,
            },
          } as SendMessageDto);
          await c.query(
            `INSERT INTO fee_reminders (school_id, student_id, balance, channel, message_id, sent_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
             ON CONFLICT (student_id, sent_on) DO NOTHING`,
            [t.student_id, balance.toFixed(2), dto.channel, row.id],
          );
        });
        out.sent += 1;
      } catch (error) {
        out.failed += 1;
        this.logger.warn(
          `fee reminder skipped for student ${t.student_id}: ${(error as Error).message}`,
        );
      }
    }
    await this.db.tenant(tenant, (c) =>
      this.audit.stage(ctx, c, {
        action: 'fees.defaulter.notify',
        entityType: 'fee_reminders',
        entityId: 'bulk',
        after: { asOf, channel: dto.channel, requested: dto.studentIds.length, ...out },
      }),
    );
    return out;
  }
}
