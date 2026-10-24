import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import { amountInWords } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { AccessService } from '../../access/access.service';
import { STORAGE_DRIVER } from '../../files/storage';
import { PEOPLE } from '../people.permissions';
import { ExitClearanceService, type ClearanceApprover } from './exit-clearance.service';
import { exitLetterPdf, fnfPdf, type SchoolHead } from './exit-pdf';
import type { CloseDto, FnfDecisionDto, FnfLinesDto, FnfPaidDto, RegisterDto } from './exits.dto';

export interface FnfLine {
  kind: 'earning' | 'deduction';
  code: string;
  label: string;
  amount: number;
  note: string | null;
  /** dues a clearance department noted: kept in step with the clearance, not typed */
  fromClearance?: boolean;
}
type FnfStatus = 'draft' | 'submitted' | 'approved' | 'paid';
interface ExitCore {
  id: string;
  status: string;
  employee_id: string;
  emp_user: string | null;
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  joined_on: string | null;
  exit_type: string;
  type_name: string | null;
  requested_on: string;
  accepted_last_day: string | null;
  proposed_last_day: string;
  notice_days: number;
  expected_last_day: string;
  notice_waived: boolean;
  left_on: string | null;
}
export type LetterKind = 'acceptance' | 'relieving' | 'experience';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '');
const today = () => new Date().toISOString().slice(0, 10);
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const rupees = (n: number) =>
  `Rupees ${amountInWords(Math.abs(n)).replace(/\b[a-z]/g, (ch) => ch.toUpperCase())} Only`;

const FIXED: Array<Omit<FnfLine, 'amount' | 'note'>> = [
  { kind: 'earning', code: 'salary', label: 'Salary for the days worked' },
  { kind: 'earning', code: 'leave_encashment', label: 'Leave encashment' },
  { kind: 'earning', code: 'gratuity', label: 'Gratuity' },
  { kind: 'earning', code: 'bonus', label: 'Bonus' },
  { kind: 'earning', code: 'other_earning', label: 'Other earnings' },
  { kind: 'deduction', code: 'notice', label: 'Notice period shortfall' },
  { kind: 'deduction', code: 'advances', label: 'Advances and loans' },
  { kind: 'deduction', code: 'tds', label: 'TDS' },
  { kind: 'deduction', code: 'other_deduction', label: 'Other deductions' },
];

/**
 * Employee exit, part 7 (docs/design/38): the manual full and final statement (accounts types the
 * earnings and deductions; the clearance dues come in by themselves), its approval by the set-up
 * approvers, printing and payment; the letters; the close on or after the last working day; the exit
 * register.
 */
@Injectable()
export class ExitSettleService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clearance: ExitClearanceService,
    private readonly access: AccessService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async core(c: PoolClient, exitId: string): Promise<ExitCore> {
    if (!/^\d{1,18}$/.test(exitId))
      throw new DomainError('not-found', 'Exit not found', { status: 404 });
    const r = await c.query<ExitCore>(
      `SELECT x.id::text, x.status, x.employee_id::text, e.user_id::text AS emp_user, e.display_name AS name, e.employee_code AS code,
              e.designation, e.department, e.joined_on::text, x.exit_type, t.name AS type_name, x.requested_on::text,
              x.accepted_last_day::text, x.proposed_last_day::text, x.notice_days, x.expected_last_day::text, x.notice_waived,
              x.left_on::text
         FROM employee_exits x JOIN employees e ON e.id = x.employee_id
         LEFT JOIN employee_exit_types t ON t.code = x.exit_type WHERE x.id = $1`,
      [exitId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Exit not found', { status: 404 });
    return r.rows[0];
  }

  private canSee(ctx: RequestContext, x: ExitCore) {
    return (
      ctx.permissions?.has(PEOPLE.exitView) === true ||
      ctx.permissions?.has(PEOPLE.exitFnf) === true ||
      (x.emp_user !== null && x.emp_user === ctx.user.id)
    );
  }

  private async fnfApprovers(c: PoolClient): Promise<ClearanceApprover[]> {
    const r = await c.query<{ fnf_approvers: ClearanceApprover[] }>(
      `SELECT fnf_approvers FROM employee_exit_settings`,
    );
    return r.rows[0]?.fnf_approvers ?? [{ kind: 'role', code: 'school_admin' }];
  }

  private async event(
    c: PoolClient,
    ctx: RequestContext,
    exitId: string,
    what: string,
    note: string | null,
  ) {
    await c.query(
      `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
       VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4)`,
      [exitId, what, note, ctx.user.displayName],
    );
  }

  // ---- the statement ------------------------------------------------------------------------------
  /** The dues the clearance departments noted, as deduction lines. */
  private async duesLines(c: PoolClient, exitId: string): Promise<FnfLine[]> {
    const r = await c.query<{
      department: string;
      name: string;
      dues: string;
      note: string | null;
    }>(
      `SELECT department, name, dues::text, note FROM exit_clearances WHERE exit_id = $1 AND dues > 0 ORDER BY sort_order, name`,
      [exitId],
    );
    return r.rows.map((d) => ({
      kind: 'deduction',
      code: `dues_${d.department}`,
      label: `Dues: ${d.name}`,
      amount: Number(d.dues),
      note: d.note,
      fromClearance: true,
    }));
  }

  private totals(lines: FnfLine[]) {
    const earnings = r2(
      lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amount, 0),
    );
    const deductions = r2(
      lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount, 0),
    );
    return { earnings, deductions, net: r2(earnings - deductions) };
  }

  private async write(c: PoolClient, exitId: string, lines: FnfLine[]) {
    const t = this.totals(lines);
    await c.query(
      `UPDATE employee_fnf SET lines = $2::jsonb, earnings = $3, deductions = $4, net = $5, updated_at = now(), updated_by = app.current_user_id()
        WHERE exit_id = $1`,
      [exitId, JSON.stringify(lines), t.earnings, t.deductions, t.net],
    );
  }

  /** The statement of an accepted exit, made the first time with the lines to fill. */
  private async ensure(c: PoolClient, x: ExitCore) {
    const has = await c.query(`SELECT 1 FROM employee_fnf WHERE exit_id = $1`, [x.id]);
    if (has.rowCount) return;
    if (x.status !== 'approved')
      throw new DomainError(
        'people.fnf_not_yet',
        'The full and final statement is made once the exit is accepted',
        { status: 409 },
      );
    const short =
      !x.notice_waived && x.notice_days > 0
        ? Math.max(0, days(x.expected_last_day, x.accepted_last_day ?? x.proposed_last_day))
        : 0;
    const lines: FnfLine[] = [
      ...FIXED.map((f) => ({
        ...f,
        amount: 0,
        note: f.code === 'notice' && short ? `${String(short)} days short` : null,
      })),
      ...(await this.duesLines(c, x.id)),
    ];
    await c.query(
      `INSERT INTO employee_fnf (school_id, exit_id, prepared_by, updated_by) VALUES (app.current_school_id(), $1, app.current_user_id(), app.current_user_id())`,
      [x.id],
    );
    await this.write(c, x.id, lines);
  }

  private async read(c: PoolClient, ctx: RequestContext, x: ExitCore) {
    const r = await c.query<{
      lines: FnfLine[];
      earnings: string;
      deductions: string;
      net: string;
      status: FnfStatus;
      prepared_by: string | null;
      submitted_at: Date | null;
      decided_by: string | null;
      decided_at: Date | null;
      decision_note: string | null;
      paid_on: string | null;
      paid_mode: string | null;
      paid_reference: string | null;
    }>(
      `SELECT f.lines, f.earnings::text, f.deductions::text, f.net::text, f.status, pu.display_name AS prepared_by, f.submitted_at,
              du.display_name AS decided_by, f.decided_at, f.decision_note, f.paid_on::text, f.paid_mode, f.paid_reference
         FROM employee_fnf f LEFT JOIN users pu ON pu.id = f.prepared_by LEFT JOIN users du ON du.id = f.decided_by
        WHERE f.exit_id = $1`,
      [x.id],
    );
    const f = r.rows[0];
    if (!f) return null;
    const approvers = await this.fnfApprovers(c);
    const decide =
      f.status === 'submitted' &&
      this.clearance.mayAct(approvers, await this.clearance.actorOf(c, ctx), x.department);
    const fnf = ctx.permissions?.has(PEOPLE.exitFnf) === true;
    const pendingClear = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM exit_clearances WHERE exit_id = $1 AND status = 'pending'`,
      [x.id],
    );
    return {
      status: f.status,
      lines: f.lines,
      earnings: Number(f.earnings),
      deductions: Number(f.deductions),
      net: Number(f.net),
      preparedBy: f.prepared_by,
      submittedAt: f.submitted_at?.toISOString() ?? null,
      decidedBy: f.decided_by,
      decidedAt: f.decided_at?.toISOString() ?? null,
      note: f.decision_note,
      paidOn: f.paid_on,
      paidMode: f.paid_mode,
      paidReference: f.paid_reference,
      clearancePending: pendingClear.rows[0]!.n,
      may: {
        edit: fnf && f.status === 'draft' && x.status === 'approved',
        submit:
          fnf && f.status === 'draft' && x.status === 'approved' && pendingClear.rows[0]!.n === 0,
        decide,
        pay: fnf && f.status === 'approved',
      },
    };
  }

  /** The statement of an exit (made on first look by accounts once the exit is accepted). */
  async fnf(ctx: RequestContext, exitId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      if (!this.canSee(ctx, x))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      if (ctx.permissions?.has(PEOPLE.exitFnf) === true && x.status === 'approved') {
        await this.ensure(c, x);
        // the clearance dues follow the clearance while the statement is a draft
        const draft = await c.query<{ lines: FnfLine[] }>(
          `SELECT lines FROM employee_fnf WHERE exit_id = $1 AND status = 'draft'`,
          [x.id],
        );
        if (draft.rows[0])
          await this.write(c, x.id, [
            ...draft.rows[0].lines.filter((l) => !l.fromClearance),
            ...(await this.duesLines(c, x.id)),
          ]);
      }
      return { statement: await this.read(c, ctx, x) };
    });
  }

  async saveLines(ctx: RequestContext, exitId: string, dto: FnfLinesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      await this.ensure(c, x);
      const st = await c.query<{ status: FnfStatus }>(
        `SELECT status FROM employee_fnf WHERE exit_id = $1 FOR UPDATE`,
        [x.id],
      );
      if (st.rows[0]!.status !== 'draft')
        throw new DomainError(
          'people.fnf_locked',
          'The statement is sent for approval: it cannot be changed now',
          {
            status: 409,
          },
        );
      const typed = dto.lines.filter((l) => !l.code.startsWith('dues_'));
      if (new Set(typed.map((l) => l.code)).size !== typed.length)
        throw new DomainError('validation-failed', 'Each line needs its own code', { status: 400 });
      await this.write(c, x.id, [
        ...typed.map((l) => ({
          kind: l.kind,
          code: l.code,
          label: l.label,
          amount: r2(l.amount),
          note: l.note?.trim() || null,
        })),
        ...(await this.duesLines(c, x.id)),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.exit.fnf_save',
        entityType: 'employee_exits',
        entityId: x.id,
        after: { lines: typed.length },
      });
      return { statement: await this.read(c, ctx, x) };
    });
  }

  /** Accounts sends the statement to the approvers, once every department has cleared. */
  async submit(ctx: RequestContext, exitId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      await this.ensure(c, x);
      const left = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM exit_clearances WHERE exit_id = $1 AND status = 'pending'`,
        [x.id],
      );
      if (left.rows[0]!.n)
        throw new DomainError(
          'people.fnf_clearance_open',
          `${String(left.rows[0]!.n)} department(s) have not cleared yet: the dues are not final`,
          { status: 409 },
        );
      const r = await c.query(
        `UPDATE employee_fnf SET status = 'submitted', submitted_at = now(), decision_note = NULL, updated_at = now(), updated_by = app.current_user_id()
          WHERE exit_id = $1 AND status = 'draft'`,
        [x.id],
      );
      if (!r.rowCount)
        throw new DomainError('people.fnf_locked', 'The statement is already sent', {
          status: 409,
        });
      await this.event(c, ctx, x.id, 'fnf_submitted', null);
      return { statement: await this.read(c, ctx, x) };
    });
  }

  /** The approver approves the statement, or sends it back to accounts with a remark. */
  async decide(
    ctx: RequestContext,
    exitId: string,
    outcome: 'approve' | 'reject',
    dto: FnfDecisionDto,
  ) {
    if (outcome === 'reject' && !dto.note?.trim())
      throw new DomainError('validation-failed', 'Say what to change', {
        status: 400,
        extra: { errors: { note: 'is required' } },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      const st = await c.query<{ status: FnfStatus }>(
        `SELECT status FROM employee_fnf WHERE exit_id = $1 FOR UPDATE`,
        [x.id],
      );
      if (st.rows[0]?.status !== 'submitted')
        throw new DomainError(
          'people.fnf_not_submitted',
          'The statement is not waiting for approval',
          {
            status: 409,
          },
        );
      if (
        !this.clearance.mayAct(
          await this.fnfApprovers(c),
          await this.clearance.actorOf(c, ctx),
          x.department,
        )
      )
        throw new DomainError('permission-denied', 'You do not approve full and final statements', {
          status: 403,
        });
      await c.query(
        `UPDATE employee_fnf SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3,
                updated_at = now(), updated_by = app.current_user_id() WHERE exit_id = $1`,
        [x.id, outcome === 'approve' ? 'approved' : 'draft', dto.note?.trim() || null],
      );
      await this.event(
        c,
        ctx,
        x.id,
        outcome === 'approve' ? 'fnf_approved' : 'fnf_returned',
        dto.note?.trim() || null,
      );
      return { statement: await this.read(c, ctx, x) };
    });
  }

  /** Accounts marks the approved statement paid (or recovered) with the mode and reference. */
  async paid(ctx: RequestContext, exitId: string, dto: FnfPaidDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      const r = await c.query<{ net: string }>(
        `UPDATE employee_fnf SET status = 'paid', paid_on = $2::date, paid_mode = $3, paid_reference = $4, paid_by = app.current_user_id(),
                updated_at = now(), updated_by = app.current_user_id()
          WHERE exit_id = $1 AND status = 'approved' RETURNING net::text`,
        [x.id, dto.paidOn ?? today(), dto.mode, dto.reference?.trim() || null],
      );
      if (!r.rows[0])
        throw new DomainError('people.fnf_not_approved', 'Only an approved statement is paid', {
          status: 409,
        });
      const net = Number(r.rows[0].net);
      await this.event(
        c,
        ctx,
        x.id,
        'fnf_paid',
        `${net >= 0 ? 'Paid' : 'Recovered'} Rs. ${Math.abs(net).toLocaleString('en-IN')} by ${dto.mode}${dto.reference ? ` (${dto.reference})` : ''}`,
      );
      return { statement: await this.read(c, ctx, x) };
    });
  }

  private async head(
    c: PoolClient,
  ): Promise<{ head: SchoolHead; logo: { contentType: string; bytes: Buffer } | null }> {
    const s = (
      await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name,
                NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'line2'), ''),
                       NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), ''),
                       NULLIF(btrim(COALESCE(address->>'pincode', address->>'pin')), '')), '') AS address,
                NULLIF(concat_ws(' · ', 'Phone ' || NULLIF(btrim(contact->>'phone'), ''), NULLIF(btrim(contact->>'email'), ''),
                       NULLIF(btrim(contact->>'website'), '')), '') AS contact,
                NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      )
    ).rows[0]!;
    let logo: { contentType: string; bytes: Buffer } | null = null;
    if (s.logo && /^\d{1,18}$/.test(s.logo)) {
      const f = await c.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
        [s.logo],
      );
      if (f.rows[0])
        try {
          logo = {
            contentType: f.rows[0].content_type,
            bytes: await this.storage.read(f.rows[0].object_key),
          };
        } catch {
          logo = null;
        }
    }
    return { head: { name: s.name, address: s.address, contact: s.contact }, logo };
  }

  /** The statement as a PDF (the office, accounts; the employee once it is approved). */
  async fnfFile(ctx: RequestContext, exitId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      if (!this.canSee(ctx, x))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      const s = await this.read(c, ctx, x);
      if (!s)
        throw new DomainError('not-found', 'No full and final statement yet', { status: 404 });
      const office = ctx.permissions?.has(PEOPLE.exitView) || ctx.permissions?.has(PEOPLE.exitFnf);
      if (!office && !['approved', 'paid'].includes(s.status))
        throw new DomainError('not-found', 'The statement is not approved yet', { status: 404 });
      const { head, logo } = await this.head(c);
      const label: Record<FnfStatus, string> = {
        draft: 'Draft',
        submitted: 'Waiting for approval',
        approved: 'Approved',
        paid: s.net >= 0 ? `Paid on ${dmy(s.paidOn)}` : `Recovered on ${dmy(s.paidOn)}`,
      };
      const bytes = await fnfPdf({
        school: head,
        logo,
        ref: `FNF/${x.id}`,
        date: dmy(today()),
        employee: [
          ['Employee', `${x.name} (${x.code})`],
          ['Designation', [x.designation, x.department].filter(Boolean).join(', ')],
          ['Exit', x.type_name ?? x.exit_type],
          ['Joined on', dmy(x.joined_on)],
          ['Last working day', dmy(x.left_on ?? x.accepted_last_day ?? x.proposed_last_day)],
        ],
        earnings: s.lines.filter((l) => l.kind === 'earning' && l.amount),
        deductions: s.lines.filter((l) => l.kind === 'deduction' && l.amount),
        totals: { earnings: s.earnings, deductions: s.deductions, net: s.net },
        words: `${s.net >= 0 ? 'Net payable' : 'Net recoverable'}: ${rupees(s.net)}.${s.paidMode ? ` ${s.net >= 0 ? 'Paid' : 'Recovered'} by ${s.paidMode}${s.paidReference ? `, reference ${s.paidReference}` : ''}.` : ''}`,
        status: label[s.status],
      });
      return { filename: `FNF-${x.code}.pdf`, bytes };
    });
  }

  /** A letter: acceptance of resignation (once accepted), relieving letter and experience certificate (once closed). */
  async letter(ctx: RequestContext, exitId: string, kind: LetterKind) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      if (!this.canSee(ctx, x))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      const exitName = (x.type_name ?? x.exit_type).toLowerCase();
      if (kind === 'acceptance' && !['approved', 'closed'].includes(x.status))
        throw new DomainError('people.letter_not_yet', 'The exit is not accepted yet', {
          status: 409,
        });
      if (kind !== 'acceptance' && x.status !== 'closed')
        throw new DomainError('people.letter_not_yet', 'The exit is not closed yet', {
          status: 409,
        });
      const { head, logo } = await this.head(c);
      const post = [x.designation, x.department].filter(Boolean).join(', ');
      const last = dmy(x.left_on ?? x.accepted_last_day ?? x.proposed_last_day);
      const to = [x.name, `Employee code ${x.code}`, ...(post ? [post] : [])];
      const text: Record<LetterKind, { title: string; subject: string; paragraphs: string[] }> = {
        acceptance: {
          title: `Acceptance of ${exitName}`,
          subject: `Your ${exitName} dated ${dmy(x.requested_on)}`,
          paragraphs: [
            `This is to acknowledge your ${exitName} dated ${dmy(x.requested_on)}${post ? ` from the post of ${post}` : ''}. It is accepted, and your last working day with the school will be ${last}.`,
            x.notice_days
              ? x.notice_waived
                ? `The school waives the part of the ${String(x.notice_days)}-day notice period not served.`
                : `The notice period of ${String(x.notice_days)} days applies as per the terms of your service.`
              : '',
            'Please complete the no-dues clearance with the departments before your last working day. Your full and final settlement will follow.',
          ].filter(Boolean),
        },
        relieving: {
          title: 'Relieving letter',
          subject: 'Relieving from the services of the school',
          paragraphs: [
            `This is to certify that ${x.name} (employee code ${x.code})${post ? `, ${post},` : ''} is relieved from the services of ${head.name} with effect from the close of working hours on ${last}, consequent upon the ${exitName}.`,
            'The no-dues clearance is complete and the full and final settlement is made.',
            'We wish them the very best for the future.',
          ],
        },
        experience: {
          title: 'Experience certificate',
          subject: 'Experience certificate',
          paragraphs: [
            `This is to certify that ${x.name} (employee code ${x.code}) worked with ${head.name}${post ? ` as ${post}` : ''}${x.joined_on ? ` from ${dmy(x.joined_on)}` : ''} to ${last}.`,
            'During this period their conduct and work were found satisfactory.',
            'This certificate is issued on their request for whatever purpose it may serve.',
          ],
        },
      };
      const t = text[kind];
      const bytes = await exitLetterPdf({
        school: head,
        logo,
        title: t.title,
        ref: `EXIT/${x.id}/${kind.slice(0, 3).toUpperCase()}`,
        date: dmy(kind === 'acceptance' ? today() : (x.left_on ?? today())),
        to,
        subject: t.subject,
        paragraphs: t.paragraphs,
        signer: 'Principal',
      });
      await this.audit.stage(ctx, c, {
        action: 'people.exit.letter',
        entityType: 'employee_exits',
        entityId: x.id,
        after: { kind },
      });
      return { filename: `${t.title.replace(/\s+/g, '-')}-${x.code}.pdf`, bytes };
    });
  }

  // ---- the close ----------------------------------------------------------------------------------
  /** What still stands between the exit and its close. */
  private async blockers(c: PoolClient, x: ExitCore, leftOn: string): Promise<string[]> {
    const out: string[] = [];
    if (x.status !== 'approved') out.push('The exit is not accepted (or is already closed)');
    const left = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM exit_clearances WHERE exit_id = $1 AND status = 'pending'`,
      [x.id],
    );
    if (left.rows[0]!.n) out.push(`${String(left.rows[0]!.n)} department(s) have not cleared`);
    const f = await c.query<{ status: string }>(
      `SELECT status FROM employee_fnf WHERE exit_id = $1`,
      [x.id],
    );
    if (!['approved', 'paid'].includes(f.rows[0]?.status ?? ''))
      out.push('The full and final statement is not approved');
    if (leftOn > today()) out.push(`The last working day (${dmy(leftOn)}) has not come yet`);
    if (leftOn < x.requested_on) out.push('The leaving date is before the day of the request');
    return out;
  }

  /** The close: inactive with the leaving date, sign-ins and roles stopped, assignments ended. */
  async close(ctx: RequestContext, exitId: string, dto: CloseDto) {
    const result = await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      const leftOn = dto.leftOn ?? x.accepted_last_day ?? x.proposed_last_day;
      const blocked = await this.blockers(c, x, leftOn);
      if (blocked.length)
        throw new DomainError('people.exit_not_ready', blocked.join('. '), {
          status: 409,
          extra: { blockers: blocked },
        });
      await c.query(`SELECT set_config('app.status_reason', $1, true)`, [
        `exit: ${x.type_name ?? x.exit_type}`,
      ]);
      await c.query(
        `UPDATE employees SET status = 'inactive', left_on = $2::date, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [x.employee_id, leftOn],
      );
      if (x.emp_user) {
        await c.query(
          `UPDATE user_school_memberships SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
            WHERE user_id = $1 AND school_id = app.current_school_id() AND person_type = 'employee'`,
          [x.emp_user],
        );
        await c.query(
          `UPDATE user_roles SET revoked_at = now(), revoked_by = app.current_user_id(), reason = COALESCE(reason, '') || ' · left the school',
                  updated_at = now(), updated_by = app.current_user_id()
            WHERE user_id = $1 AND school_id = app.current_school_id() AND revoked_at IS NULL`,
          [x.emp_user],
        );
      }
      // what they held, ended on the leaving day and listed for re-assignment
      const held = await c.query<{ kind: string; what: string }>(
        `UPDATE teacher_assignments ta SET valid_to = GREATEST(ta.valid_from, $2::date), updated_at = now(), updated_by = app.current_user_id()
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.id = ta.class_section_id AND ta.employee_id = $1 AND (ta.valid_to IS NULL OR ta.valid_to > $2::date)
        RETURNING ta.kind::text AS kind,
                  k.code || '-' || cs.name || COALESCE(' ' || (SELECT s.name FROM subjects s WHERE s.id = ta.subject_id), '') AS what`,
        [x.employee_id, leftOn],
      );
      const hod = await c.query<{ name: string }>(
        `SELECT name FROM departments WHERE hod_employee_id = $1 AND status = 'active'`,
        [x.employee_id],
      );
      const team = await c.query<{ name: string }>(
        `SELECT e.display_name AS name FROM postings p JOIN employees e ON e.id = p.employee_id
          WHERE p.reports_to_employee_id = $1 AND p.academic_year_id = app.current_academic_year_id() AND e.status = 'active' AND e.deleted_at IS NULL`,
        [x.employee_id],
      );
      const handover = [
        ...held.rows.map((h) => ({
          kind: h.kind === 'class_teacher' ? 'Class teacher' : 'Subject teacher',
          what: h.what,
        })),
        ...hod.rows.map((h) => ({ kind: 'HOD', what: h.name })),
        ...team.rows.map((t) => ({ kind: 'Reports to them', what: t.name })),
      ];
      await c.query(
        `UPDATE employee_exits SET status = 'closed', left_on = $2::date, closed_at = now(), closed_by = app.current_user_id(), handover = $3::jsonb,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [x.id, leftOn, JSON.stringify(handover)],
      );
      await this.event(
        c,
        ctx,
        x.id,
        'closed',
        `Left on ${dmy(leftOn)}${handover.length ? ` · ${String(handover.length)} item(s) to re-assign` : ''}`,
      );
      await this.audit.stage(ctx, c, {
        action: 'people.exit.close',
        entityType: 'employee_exits',
        entityId: x.id,
        after: { employeeId: x.employee_id, leftOn, handover },
      });
      const sc = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
      return { leftOn, handover, schoolId: sc.rows[0]!.id };
    });
    // the leaver's rights changed: cached sets are dropped once this is saved
    await this.access.invalidateSchool(result.schoolId).catch(() => undefined);
    return { leftOn: result.leftOn, handover: result.handover };
  }

  /** What the close would need (shown beside the button). */
  async closeCheck(ctx: RequestContext, exitId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.core(c, exitId);
      if (!this.canSee(ctx, x))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      const leftOn = x.accepted_last_day ?? x.proposed_last_day;
      return { leftOn, blockers: x.status === 'closed' ? [] : await this.blockers(c, x, leftOn) };
    });
  }

  // ---- the register -------------------------------------------------------------------------------
  private async registerRows(c: PoolClient, q: RegisterDto) {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      employee_type: string;
      designation: string | null;
      department: string | null;
      exit_type: string;
      reason: string;
      requested_on: string;
      last_day: string;
      left_on: string | null;
      status: string;
      notice_waived: boolean;
      net: string | null;
      fnf_status: string | null;
      paid_on: string | null;
    }>(
      `SELECT x.id::text, e.employee_code AS code, e.display_name AS name, e.employee_type::text, e.designation, e.department,
              COALESCE(t.name, x.exit_type) AS exit_type, x.reason, x.requested_on::text,
              COALESCE(x.accepted_last_day, x.proposed_last_day)::text AS last_day, x.left_on::text, x.status, x.notice_waived,
              f.net::text, f.status AS fnf_status, f.paid_on::text
         FROM employee_exits x JOIN employees e ON e.id = x.employee_id
         LEFT JOIN employee_exit_types t ON t.code = x.exit_type LEFT JOIN employee_fnf f ON f.exit_id = x.id
        WHERE x.status IN ('approved', 'closed')
          AND ($1::date IS NULL OR COALESCE(x.left_on, x.accepted_last_day, x.proposed_last_day) >= $1::date)
          AND ($2::date IS NULL OR COALESCE(x.left_on, x.accepted_last_day, x.proposed_last_day) <= $2::date)
          AND ($3::text IS NULL OR x.exit_type = $3)
        ORDER BY COALESCE(x.left_on, x.accepted_last_day, x.proposed_last_day) DESC, e.display_name`,
      [q.from ?? null, q.to ?? null, q.exitType ?? null],
    );
    return r.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      employeeType: x.employee_type,
      designation: x.designation,
      department: x.department,
      exitType: x.exit_type,
      reason: x.reason,
      requestedOn: x.requested_on,
      lastDay: x.last_day,
      leftOn: x.left_on,
      status: x.status,
      noticeWaived: x.notice_waived,
      net: x.net !== null ? Number(x.net) : null,
      fnfStatus: x.fnf_status,
      paidOn: x.paid_on,
    }));
  }

  /** Who left (closed) or is leaving (accepted), with the settlement. */
  async register(ctx: RequestContext, q: RegisterDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: await this.registerRows(c, q),
    }));
  }

  async registerFile(
    ctx: RequestContext,
    q: RegisterDto,
  ): Promise<{ filename: string; bytes: Buffer }> {
    const rows = await this.db.tenant(requireTenant(ctx), (c) => this.registerRows(c, q));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Exit register');
    ws.columns = [
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Type', key: 'employeeType', width: 14 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Exit', key: 'exitType', width: 16 },
      { header: 'Reason', key: 'reason', width: 36 },
      { header: 'Asked on', key: 'requestedOn', width: 12 },
      { header: 'Last working day', key: 'lastDay', width: 16 },
      { header: 'Left on', key: 'leftOn', width: 12 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Notice waived', key: 'noticeWaived', width: 13 },
      { header: 'FNF net (Rs)', key: 'net', width: 14 },
      { header: 'FNF', key: 'fnfStatus', width: 12 },
      { header: 'Paid on', key: 'paidOn', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows)
      ws.addRow({
        ...r,
        requestedOn: dmy(r.requestedOn),
        lastDay: dmy(r.lastDay),
        leftOn: dmy(r.leftOn),
        status: r.status === 'closed' ? 'Left' : 'Leaving',
        noticeWaived: r.noticeWaived ? 'Yes' : 'No',
        paidOn: dmy(r.paidOn),
      });
    return { filename: 'exit-register.xlsx', bytes: Buffer.from(await wb.xlsx.writeBuffer()) };
  }
}
