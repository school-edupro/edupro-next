import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import JSZip from 'jszip';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { STORAGE_DRIVER } from '../files/storage';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, has, hiddenFor, monthWords, must, runCan } from './payroll-month';
import type { Payslip } from './payroll-payslip';
import { passwordFor, patternInWords, payslipPdf, payslipsPdf } from './payroll-payslip-pdf';
import { PAYROLL } from './payroll.dto';

export const OWN = 'payroll.own.view';

/**
 * Payslips (docs/design/86, phase B step 5; PAYROLL_RUN_SPEC.md §8): a payslip of a locked run as a PDF —
 * locked with the employee's password, the payroll admin's office copy unlocked — all of a run in one office
 * copy or a zip of locked files, e-mailed with the locked PDF only when a checker presses "Send pending", and
 * My payslips for every employee.
 */
@Injectable()
export class PayrollPayslipService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async logo(
    c: PoolClient,
    fileId: string | null | undefined,
  ): Promise<LetterheadLogo | null> {
    if (!fileId) return null;
    const f = (
      await c.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM files WHERE id = $1`,
        [fileId],
      )
    ).rows[0];
    if (!f) return null;
    try {
      return { contentType: f.content_type, bytes: await this.storage.read(f.object_key) };
    } catch {
      return null;
    }
  }
  private async pattern(c: PoolClient) {
    return (
      (await c.query<{ p: string | null }>(`SELECT payslip_password AS p FROM payroll_settings`))
        .rows[0]?.p ?? null
    );
  }
  /** A record's frozen payslip, released only once its run is locked. */
  private async slip(c: PoolClient, recordId: string, runId?: string) {
    const r = (
      await c.query<{
        employee_id: string;
        code: string;
        month: string;
        payslip: Payslip | null;
        stage: string;
        status: string;
      }>(
        `SELECT r.employee_id::text, r.employee_code AS code, to_char(r.month, 'YYYY-MM') AS month, r.payslip, u.stage, r.status
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.id = $1 AND ($2::bigint IS NULL OR r.run_id = $2::bigint) AND u.deleted_at IS NULL`,
        [recordId, runId ?? null],
      )
    ).rows[0];
    if (!r) bad('Payslip not found', 404);
    if (!['LOCKED', 'PAID'].includes(r!.stage) || !r!.payslip || r!.status === 'FAILED')
      bad('A payslip is released when its run is locked', 409);
    return r!;
  }
  private async render(c: PoolClient, slip: Payslip, employeeId: string, locked: boolean) {
    const pattern = locked ? await this.pattern(c) : null;
    const pw = await passwordFor(c, employeeId, pattern);
    const pdf = await payslipPdf(slip, await this.logo(c, slip.school?.logoFileId), pw.password);
    return {
      pdf,
      locked: !!pw.password,
      note:
        pattern && !pw.password
          ? `Not locked: ${pw.missing.join(', ')} not on the employee record`
          : null,
    };
  }

  /** One payslip for payroll staff: locked with the employee's password; the payroll admin's copy unlocked. */
  async recordPayslip(ctx: RequestContext, runId: string, recordId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.slip(c, recordId, runId);
      if ((await hiddenFor(c, ctx)).includes(r.employee_id)) bad('Payslip not found', 404);
      const out = await this.render(c, r.payslip!, r.employee_id, !has(ctx, PAYROLL.admin));
      await this.audit.stage(ctx, c, {
        action: 'payroll.payslip.download',
        entityType: 'payroll_records',
        entityId: recordId,
        after: { locked: out.locked },
      });
      return {
        filename: `Payslip_${r.code}_${r.month}.pdf`,
        base64: out.pdf.toString('base64'),
        locked: out.locked,
        note: out.note,
      };
    });
  }

  /** All of a run's payslips: one office copy (unlocked), or a zip of each employee's locked file (a checker). */
  async runPayslips(ctx: RequestContext, runId: string, mode: 'single' | 'zip') {
    must(ctx, RUN.approve, 'Only a payroll checker downloads a run’s payslips');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = (
        await c.query<{ stage: string; month: string }>(
          `SELECT stage, to_char(month, 'YYYY-MM') AS month FROM payroll_runs WHERE id = $1 AND deleted_at IS NULL`,
          [runId],
        )
      ).rows[0];
      if (!run) bad('Run not found', 404);
      if (!['LOCKED', 'PAID'].includes(run!.stage))
        bad('Payslips are released when the run is locked', 409);
      const recs = (
        await c.query<{ id: string; employee_id: string; code: string; payslip: Payslip }>(
          `SELECT id::text, employee_id::text, employee_code AS code, payslip FROM payroll_records
            WHERE run_id = $1 AND status <> 'FAILED' AND payslip IS NOT NULL ORDER BY employee_code`,
          [runId],
        )
      ).rows;
      let base64: string;
      let filename: string;
      let unlocked = 0;
      if (mode === 'single') {
        base64 = (
          await payslipsPdf(
            recs.map((r) => r.payslip),
            await this.logo(c, recs[0]?.payslip.school?.logoFileId),
          )
        ).toString('base64');
        filename = `Payslips_${run!.month}.pdf`;
      } else {
        const zip = new JSZip();
        for (const r of recs) {
          const out = await this.render(c, r.payslip, r.employee_id, true);
          if (!out.locked) unlocked += 1;
          zip.file(`${r.code}.pdf`, out.pdf);
        }
        base64 = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
        filename = `Payslips_${run!.month}.zip`;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.payslip.bulk',
        entityType: 'payroll_runs',
        entityId: runId,
        after: { mode, count: recs.length, unlocked },
      });
      return { filename, base64, count: recs.length, unlocked };
    });
  }

  /**
   * "Send pending" (a checker): each payslip of the run not yet e-mailed goes to the employee's e-mail with its
   * locked PDF (the legacy e-mail carried no file). A payslip that cannot be locked is not e-mailed (it stays in My
   * payslips). Nothing sends by itself.
   */
  async sendPending(ctx: RequestContext, runId: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sends the payslips');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = (
        await c.query<{ stage: string; month: string }>(
          `SELECT stage, to_char(month, 'YYYY-MM') AS month FROM payroll_runs WHERE id = $1 AND deleted_at IS NULL`,
          [runId],
        )
      ).rows[0];
      if (!run) bad('Run not found', 404);
      if (!['LOCKED', 'PAID'].includes(run!.stage))
        bad('Payslips are sent once the run is locked', 409);
      const pattern = await this.pattern(c);
      const recs = (
        await c.query<{
          id: string;
          employee_id: string;
          code: string;
          name: string;
          email: string | null;
          payslip: Payslip;
        }>(
          `SELECT r.id::text, r.employee_id::text, r.employee_code AS code, r.employee_name AS name, e.email::text AS email, r.payslip
             FROM payroll_records r JOIN employees e ON e.id = r.employee_id
            WHERE r.run_id = $1 AND r.status <> 'FAILED' AND r.payslip IS NOT NULL AND r.payslip_emailed_at IS NULL
            ORDER BY r.employee_code`,
          [runId],
        )
      ).rows;
      const school =
        (
          await c.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]?.name ?? '';
      const hint = patternInWords(pattern);
      let queued = 0;
      const noEmail: string[] = [];
      const noPassword: string[] = [];
      for (const r of recs) {
        if (!r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) {
          noEmail.push(r.code);
          continue;
        }
        const out = await this.render(c, r.payslip, r.employee_id, true);
        if (pattern && !out.locked) {
          noPassword.push(r.code);
          continue;
        }
        const name = `Payslip_${r.code}_${run!.month}.pdf`;
        const key = objectKeyFor(
          requireTenant(ctx).schoolId,
          'pdf',
          `payslip-${r.id}-${randomBytes(6).toString('hex')}`,
        );
        await this.storage.write(key, out.pdf, 'application/pdf');
        const fileId = (
          await c.query<{ id: string }>(
            `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                                owner_entity_id, classification, storage_driver, status, scanned_at, scan_result)
             VALUES (app.current_school_id(), $1, $2, 'application/pdf', $3, $4, $5, 'payroll_record', $6, 'sensitive', $7, 'ready', now(), 'generated')
             RETURNING id::text`,
            [
              this.storage.bucket,
              key,
              out.pdf.length,
              createHash('sha256').update(out.pdf).digest('hex'),
              name,
              r.id,
              this.storage.name,
            ],
          )
        ).rows[0]!.id;
        const subject = `Payslip for ${monthWords(run!.month)}`;
        const body = [
          `<p>Dear ${escapeHtml(r.name)},</p>`,
          `<p>Your payslip for ${escapeHtml(monthWords(run!.month))} is attached.</p>`,
          hint ? `<p>It opens with a password: ${escapeHtml(hint)}.</p>` : '',
          `<p>It is also in My payslips.</p>`,
          `<p>${escapeHtml(school)}</p>`,
        ].join('');
        const msg = (
          await c.query<{ id: string }>(
            `INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables, attachments)
             VALUES (app.current_school_id(), 'email', lower($1), $2, $3, 'html', 'queued', '{}'::jsonb, $4::jsonb) RETURNING id::text`,
            [
              r.email,
              subject,
              body,
              JSON.stringify([{ fileId, name, contentType: 'application/pdf' }]),
            ],
          )
        ).rows[0]!.id;
        await c.query(
          `SELECT app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL,
                    'requestId', NULL, 'kind', 'comms.message', 'payload', jsonb_build_object('messageId', $1::text)))`,
          [msg],
        );
        await c.query(
          `UPDATE payroll_records SET payslip_emailed_at = now(), payslip_message_id = $2 WHERE id = $1`,
          [r.id, msg],
        );
        queued += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.payslip.send',
        entityType: 'payroll_runs',
        entityId: runId,
        after: { queued, noEmail: noEmail.length, noPassword: noPassword.length },
      });
      return { queued, noEmail, noPassword };
    });
  }

  // ---- My payslips --------------------------------------------------------------------------------------------
  private async me(c: PoolClient) {
    const e = (
      await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE user_id = app.current_user_id() AND deleted_at IS NULL ORDER BY (status = 'active') DESC, id LIMIT 1`,
      )
    ).rows[0];
    if (!e) bad('Your sign-in is not linked to a staff record', 404);
    return e!;
  }

  async mine(ctx: RequestContext, fy?: number) {
    must(ctx, OWN, 'My payslips are for staff');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.me(c);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT r.id::text, to_char(r.month, 'YYYY-MM') AS month, u.run_type, r.is_top_up, r.gross_earned::text, r.total_deductions::text,
                  r.net_pay::text, r.status, (r.it_amount + r.cess_amount)::text AS tax, r.pt_amount::text AS pt
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
            WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
              AND r.payslip IS NOT NULL
            ORDER BY r.month DESC, r.id DESC`,
          [e.id],
        )
      ).rows.map(camelRow);
      const years = [...new Set(rows.map((r) => fyStart(r.month as string)))];
      const year = fy ?? years[0] ?? null;
      const inYear = rows.filter((r) => year !== null && fyStart(r.month as string) === year);
      const sum = (k: string) =>
        (inYear.reduce((n, r) => n + Math.round(Number(r[k]) * 100), 0) / 100).toFixed(2);
      return {
        employee: e,
        fy: year,
        years,
        rows: inYear,
        ytd: {
          count: inYear.length,
          gross: sum('grossEarned'),
          deductions: sum('totalDeductions'),
          net: sum('netPay'),
          tax: sum('tax'),
          pt: sum('pt'),
        },
        passwordHint: patternInWords(await this.pattern(c)),
      };
    });
  }

  async minePdf(ctx: RequestContext, recordId: string) {
    must(ctx, OWN, 'My payslips are for staff');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.me(c);
      const r = await this.slip(c, recordId);
      if (r.employee_id !== e.id) bad('Payslip not found', 404);
      const out = await this.render(c, r.payslip!, e.id, true);
      return {
        filename: `Payslip_${r.code}_${r.month}.pdf`,
        base64: out.pdf.toString('base64'),
        locked: out.locked,
      };
    });
  }

  /** What the payslips of a run look like for the screens: e-mailed, waiting, not sendable. */
  async runStatus(ctx: RequestContext, runId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{ released: number; emailed: number; no_email: number }>(
          `SELECT count(*) FILTER (WHERE r.payslip IS NOT NULL)::int AS released,
                  count(*) FILTER (WHERE r.payslip_emailed_at IS NOT NULL)::int AS emailed,
                  count(*) FILTER (WHERE r.payslip IS NOT NULL AND COALESCE(e.email::text, '') = '')::int AS no_email
             FROM payroll_records r JOIN employees e ON e.id = r.employee_id WHERE r.run_id = $1 AND r.status <> 'FAILED'`,
          [runId],
        )
      ).rows[0]!;
      return { ...s, passwordHint: patternInWords(await this.pattern(c)), can: runCan(ctx) };
    });
  }
}

const fyStart = (month: string) =>
  Number(month.slice(5, 7)) >= 4 ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1;
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
