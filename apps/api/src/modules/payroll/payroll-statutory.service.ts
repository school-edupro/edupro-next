import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import { registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER } from '../files/storage';
import { preparedChecked } from '../leave/leave-report-file';
import { RUN } from './payroll-inputs.dto';
import { bad, firstOf, has, hiddenFor, monthWords, must } from './payroll-month';
import {
  ecrArrearText,
  ecrMembers,
  ecrText,
  ecrTotals,
  esicRows,
  paise,
  pfChallan,
  rupees,
  type EcrMember,
  type EsiRecord,
  type PfRecord,
} from './payroll-statutory';
import type { EcrFiledDto, WithdrawDto } from './payroll-statutory.dto';
import { PAYROLL } from './payroll.dto';

const SHOWN = ['APPROVED', 'LOCKED', 'PAID'];
const FINAL = ['LOCKED', 'PAID'];
const PROVISIONAL_NOTE =
  'PROVISIONAL — an approved run of the month is not locked yet: these figures may still change.';

interface MonthRow {
  record_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  uan: string | null;
  esi_number: string | null;
  is_top_up: boolean;
  stage: string;
  gross_earned: string;
  month_days: string;
  paid_days: string;
  ncp_days: string;
  pt_amount: string;
  pt_wage: string;
  pf_wage: string | null;
  eps_wage: string | null;
  edli_wage: string | null;
  ee_pf: string | null;
  vpf: string | null;
  er_eps: string | null;
  er_epf: string | null;
  edli: string | null;
  pf_admin: string | null;
  esi_covered: boolean | null;
  esi_wage: string | null;
  esi_ee: string | null;
  esi_er: string | null;
  lwf_state: string | null;
  lwf_ee: string | null;
  lwf_er: string | null;
  arrear_pf: string;
  arrear_gross: string;
  gender: string | null;
  left_on: string | null;
}

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const fileMonth = (month: string) => month.replace('-', '_');

/**
 * PF, ESI, profession tax and LWF (docs/design/86, phase C step 2; PAYROLL_PAYMENT_SPEC.md §3–6). Each is read for
 * a month from its runs' frozen statutory rows: the registers and challan figures (an approved run's figures marked
 * PROVISIONAL), the PF ECR for the month — every locked run together; once filed, a later run gives a supplementary
 * file of only the members not yet filed —, the ESIC monthly upload (covered staff only), the profession-tax
 * register with Maharashtra's Form IIIB figures, the LWF register in its due months. Registers are a payroll
 * reader's (a maker does not see confidential staff's rows; the totals still count them); the files and the filing
 * are a checker's.
 */
@Injectable()
export class PayrollStatutoryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async rows(c: PoolClient, month: string, stages: string[]): Promise<MonthRow[]> {
    return (
      await c.query<MonthRow>(
        `SELECT r.id::text AS record_id, r.employee_id::text, r.employee_code, r.employee_name, r.uan, r.esi_number,
                r.is_top_up, u.stage, r.gross_earned::text, r.month_days::text, r.paid_days::text, r.ncp_days::text,
                r.pt_amount::text, r.pt_wage::text,
                s.pf_wage::text, s.eps_wage::text, s.edli_wage::text, s.ee_pf::text, s.vpf::text, s.er_eps::text,
                s.er_epf::text, s.edli::text, s.pf_admin::text, s.esi_covered, s.esi_wage::text, s.esi_ee::text,
                s.esi_er::text, s.lwf_state, s.lwf_ee::text, s.lwf_er::text,
                COALESCE((SELECT sum(a.amount) FROM payroll_arrears a WHERE a.paid_in_record_id = r.id AND a.pf_applicable), 0)::numeric(12, 2)::text AS arrear_pf,
                COALESCE((SELECT sum(a.amount) FROM payroll_arrears a WHERE a.paid_in_record_id = r.id), 0)::numeric(12, 2)::text AS arrear_gross,
                e.gender::text, e.left_on::text
           FROM payroll_records r
           JOIN payroll_runs u ON u.id = r.run_id
           JOIN employees e ON e.id = r.employee_id
           LEFT JOIN payroll_record_statutory s ON s.record_id = r.id
          WHERE r.month = $1::date AND u.deleted_at IS NULL AND u.stage = ANY($2::text[]) AND r.status <> 'FAILED'
          ORDER BY r.employee_name, r.employee_code, r.id`,
        [firstOf(month), stages],
      )
    ).rows;
  }

  private pfRecords(rows: MonthRow[]): PfRecord[] {
    return rows.map((r) => ({
      recordId: r.record_id,
      employeeId: r.employee_id,
      code: r.employee_code,
      name: r.employee_name,
      uan: r.uan,
      isTopUp: r.is_top_up,
      gross: r.gross_earned,
      monthDays: r.month_days,
      ncpDays: r.ncp_days,
      pfWage: r.pf_wage ?? '0.00',
      epsWage: r.eps_wage ?? '0.00',
      edliWage: r.edli_wage ?? '0.00',
      eePf: r.ee_pf ?? '0.00',
      vpf: r.vpf ?? '0.00',
      erEps: r.er_eps ?? '0.00',
      erEpf: r.er_epf ?? '0.00',
      edli: r.edli ?? '0.00',
      admin: r.pf_admin ?? '0.00',
      arrearPf: r.arrear_pf,
      arrearGross: r.arrear_gross,
    }));
  }

  private esiRecords(rows: MonthRow[]): EsiRecord[] {
    return rows.map((r) => ({
      employeeId: r.employee_id,
      code: r.employee_code,
      name: r.employee_name,
      ipNumber: r.esi_number,
      isTopUp: r.is_top_up,
      covered: r.esi_covered,
      esiWage: r.esi_wage ?? '0.00',
      esiEe: r.esi_ee ?? '0.00',
      esiEr: r.esi_er ?? '0.00',
      paidDays: r.paid_days,
      leftOn: r.left_on,
    }));
  }

  private async pfRates(c: PoolClient, month: string) {
    const r = (
      await c.query<{
        ee_rate: string;
        er_rate: string;
        eps_rate: string;
        eps_wage_ceiling: string;
        edli_wage_ceiling: string;
        admin_min: string;
        edli_min: string;
      }>(
        `SELECT ee_rate::text, er_rate::text, eps_rate::text, eps_wage_ceiling::text, edli_wage_ceiling::text,
                admin_min::text, edli_min::text
           FROM payroll_pf_settings
          WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date)
          ORDER BY effective_from DESC LIMIT 1`,
        [firstOf(month), monthEnd(month)],
      )
    ).rows[0];
    return {
      rates: {
        ee: Number(r?.ee_rate ?? 0.12),
        er: Number(r?.er_rate ?? 0.12),
        eps: Number(r?.eps_rate ?? 0.0833),
        epsCeiling: Number(r?.eps_wage_ceiling ?? 15000),
        edliCeiling: Number(r?.edli_wage_ceiling ?? 15000),
      },
      mins: { admin: r?.admin_min ?? '500.00', edli: r?.edli_min ?? '75.00' },
    };
  }

  private async settings(c: PoolClient) {
    return (
      (
        await c.query<{
          state_code: string | null;
          pf_establishment_code: string | null;
          esi_code: string | null;
          ptrc_no: string | null;
          lwf_enabled: boolean;
          ecr_arrear_mode: string;
        }>(
          `SELECT state_code, pf_establishment_code, esi_code, ptrc_no, lwf_enabled, ecr_arrear_mode FROM payroll_settings`,
        )
      ).rows[0] ?? {
        state_code: null,
        pf_establishment_code: null,
        esi_code: null,
        ptrc_no: null,
        lwf_enabled: false,
        ecr_arrear_mode: 'FOLDED',
      }
    );
  }

  private async runsOf(c: PoolClient, month: string) {
    return (
      await c.query<{ id: string; run_type: string; seq: number; stage: string }>(
        `SELECT id::text, run_type, seq, stage FROM payroll_runs WHERE month = $1::date AND deleted_at IS NULL ORDER BY id`,
        [firstOf(month)],
      )
    ).rows;
  }

  /** The month's filed ECRs, and what the next file holds: everyone if none is filed, else the members not yet filed. */
  private async ecrState(c: PoolClient, month: string, separate: boolean) {
    const { rates, mins } = await this.pfRates(c, month);
    const finalRows = await this.rows(c, month, FINAL);
    const members = ecrMembers(this.pfRecords(finalRows), rates, separate);
    const filed = (
      await c.query<{
        id: string;
        seq: number;
        ack_no: string;
        filed_on: string;
        members: number;
        totals: Record<string, string>;
        filed_by_name: string | null;
      }>(
        `SELECT r.id::text, r.seq, r.ack_no, r.filed_on::text, r.members, r.totals, u.display_name AS filed_by_name
           FROM payroll_returns r LEFT JOIN users u ON u.id = r.filed_by
          WHERE r.kind = 'ECR' AND r.month = $1::date ORDER BY r.seq`,
        [firstOf(month)],
      )
    ).rows;
    const done = (
      await c.query<{ employee_id: string; record_ids: string[] }>(
        `SELECT m.employee_id::text, m.record_ids::text[] AS record_ids FROM payroll_return_members m
           JOIN payroll_returns r ON r.id = m.return_id WHERE r.kind = 'ECR' AND r.month = $1::date`,
        [firstOf(month)],
      )
    ).rows;
    const doneEmp = new Set(done.map((d) => d.employee_id));
    const doneRec = new Set(done.flatMap((d) => d.record_ids));
    const next = members.filter((m) => !doneEmp.has(m.employeeId));
    const changed = members.filter(
      (m) => doneEmp.has(m.employeeId) && m.recordIds.some((id) => !doneRec.has(id)),
    );
    return { rates, mins, members, filed, next, changed, finalRows, seq: filed.length + 1 };
  }

  private shapeMember(m: EcrMember) {
    const s = (v: bigint) => String(v);
    return {
      employeeId: m.employeeId,
      code: m.code,
      name: m.name,
      uan: m.uan,
      gross: s(m.line.gross),
      epf: s(m.line.epf),
      eps: s(m.line.eps),
      edli: s(m.line.edli),
      ee: s(m.line.ee),
      epsShare: s(m.line.epsShare),
      diff: s(m.line.diff),
      ncp: s(m.line.ncp),
      arrear: m.arrear
        ? Object.fromEntries(Object.entries(m.arrear).map(([k, v]) => [k, String(v)]))
        : null,
      problems: m.problems,
      warnings: m.warnings,
    };
  }

  // ---- the month at a glance --------------------------------------------------------------------------------------
  async overview(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the statutory figures');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const runs = await this.runsOf(c, month);
      const shown = await this.rows(c, month, SHOWN);
      const { rates, mins } = await this.pfRates(c, month);
      const pfAll = ecrMembers(this.pfRecords(shown), rates, false);
      const esi = esicRows(this.esiRecords(shown), monthEnd(month));
      const ecr = await this.ecrState(c, month, st.ecr_arrear_mode === 'SEPARATE');
      const sum = (k: keyof MonthRow) =>
        rupees(shown.reduce((s, r) => s + paise(r[k] as string), 0n));
      const lwfRows = shown.filter((r) => paise(r.lwf_ee) + paise(r.lwf_er) > 0n);
      return {
        month,
        monthWords: monthWords(month),
        runs,
        provisional: runs.some((r) => r.stage === 'APPROVED'),
        settings: {
          state: st.state_code,
          pfCode: st.pf_establishment_code,
          esiCode: st.esi_code,
          ptrcNo: st.ptrc_no,
          lwfEnabled: st.lwf_enabled,
          ecrArrearMode: st.ecr_arrear_mode,
        },
        pf: {
          members: pfAll.length,
          challan: pfChallan(this.pfRecords(shown), mins),
          ecr: {
            filed: ecr.filed,
            next: {
              seq: ecr.seq,
              members: ecr.next.length,
              problems: ecr.next.filter((m) => m.problems.length).length,
            },
            changedAfterFiling: ecr.changed.map((m) => m.code),
          },
        },
        esi: {
          covered: esi.length,
          wages: String(esi.reduce((s, r) => s + BigInt(r.wages), 0n)),
          ee: sum('esi_ee'),
          er: sum('esi_er'),
          total: rupees(paise(sum('esi_ee')) + paise(sum('esi_er'))),
        },
        pt: {
          employees: shown.filter((r) => paise(r.pt_amount) > 0n).length,
          total: sum('pt_amount'),
        },
        lwf: {
          employees: new Set(lwfRows.map((r) => r.employee_id)).size,
          ee: sum('lwf_ee'),
          er: sum('lwf_er'),
        },
        can: { file: has(ctx, RUN.approve), admin: has(ctx, PAYROLL.admin) },
      };
    });
  }

  // ---- PF -----------------------------------------------------------------------------------------------------------
  async pf(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the PF figures');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const hidden = new Set(await hiddenFor(c, ctx));
      const shown = await this.rows(c, month, SHOWN);
      const { rates, mins } = await this.pfRates(c, month);
      const members = ecrMembers(this.pfRecords(shown), rates, false);
      const ecr = await this.ecrState(c, month, st.ecr_arrear_mode === 'SEPARATE');
      const runs = await this.runsOf(c, month);
      return {
        month,
        monthWords: monthWords(month),
        provisional: runs.some((r) => r.stage === 'APPROVED'),
        pfCode: st.pf_establishment_code,
        arrearMode: st.ecr_arrear_mode,
        rates,
        members: members.filter((m) => !hidden.has(m.employeeId)).map((m) => this.shapeMember(m)),
        hiddenCount: members.filter((m) => hidden.has(m.employeeId)).length,
        totals: ecrTotals(members),
        challan: pfChallan(this.pfRecords(shown), mins),
        ecr: {
          filed: ecr.filed,
          next: {
            seq: ecr.seq,
            kind: ecr.seq === 1 ? 'regular' : 'supplementary',
            members: ecr.next
              .filter((m) => !hidden.has(m.employeeId))
              .map((m) => this.shapeMember(m)),
            count: ecr.next.length,
            totals: ecrTotals(ecr.next),
            problems: ecr.next
              .filter((m) => m.problems.length)
              .map((m) => ({ code: m.code, problems: m.problems })),
          },
          changedAfterFiling: ecr.changed.map((m) => ({ code: m.code, name: m.name })),
          notLocked: runs
            .filter((r) => r.stage === 'APPROVED')
            .map((r) => `${r.run_type} ${String(r.seq)}`),
        },
        can: { file: has(ctx, RUN.approve), withdraw: has(ctx, PAYROLL.admin) },
      };
    });
  }

  /** The next ECR (not yet filed): the main file or its arrear file. */
  async ecrFile(ctx: RequestContext, month: string, part: 'main' | 'arrear') {
    must(ctx, RUN.approve, 'Only a payroll checker downloads the ECR');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const separate = st.ecr_arrear_mode === 'SEPARATE';
      if (part === 'arrear' && !separate)
        bad(
          'Arrears are in the main ECR (Settings: arrears folded in): there is no arrear file',
          409,
        );
      const ecr = await this.ecrState(c, month, separate);
      if (!ecr.next.length)
        bad(
          ecr.filed.length
            ? 'Every member of the month is in a filed ECR: nothing new to file'
            : `${monthWords(month)} has no locked run with PF yet`,
          409,
        );
      const blocked = ecr.next.filter((m) => m.problems.length);
      if (blocked.length)
        bad(
          `Fix these members first: ${blocked
            .slice(0, 10)
            .map((m) => `${m.code} (${m.problems.join('; ')})`)
            .join(', ')}${blocked.length > 10 ? ' …' : ''}`,
          409,
        );
      const text = part === 'arrear' ? ecrArrearText(ecr.next) : ecrText(ecr.next);
      if (!text) bad('No arrear for PF in this file', 409);
      await this.audit.stage(ctx, c, {
        action: 'payroll.ecr.download',
        entityType: 'payroll_returns',
        after: { month, seq: ecr.seq, part, members: ecr.next.length },
      });
      return {
        filename: `ECR_${part === 'arrear' ? 'ARREAR_' : ''}${fileMonth(month)}${ecr.seq > 1 ? `_SUPP${String(ecr.seq)}` : ''}.txt`,
        base64: Buffer.from(text, 'utf8').toString('base64'),
        contentType: 'text/plain; charset=utf-8',
      };
    });
  }

  /** The next ECR is filed: kept with its members and their lines; the next file is a supplementary one. */
  async ecrFiled(ctx: RequestContext, dto: EcrFiledDto) {
    must(ctx, RUN.approve, 'Only a payroll checker records a filed ECR');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('payroll.ecr.' || $1))`, [dto.month]);
      const st = await this.settings(c);
      const ecr = await this.ecrState(c, dto.month, st.ecr_arrear_mode === 'SEPARATE');
      if (!ecr.next.length) bad('Nothing new to file for the month', 409);
      if (ecr.next.some((m) => m.problems.length))
        bad(
          'Some members of this file have problems: fix them, download it again and file that',
          409,
        );
      const totals = ecrTotals(ecr.next);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_returns (school_id, kind, month, seq, members, totals, ack_no, filed_on, filed_by)
           VALUES (app.current_school_id(), 'ECR', $1::date, $2, $3, $4::jsonb, $5, $6::date, app.current_user_id())
           RETURNING id::text`,
          [
            firstOf(dto.month),
            ecr.seq,
            ecr.next.length,
            JSON.stringify(totals),
            dto.ackNo,
            dto.filedOn,
          ],
        )
      ).rows[0]!.id;
      for (const m of ecr.next) {
        const shaped = this.shapeMember(m);
        await c.query(
          `INSERT INTO payroll_return_members (return_id, school_id, employee_id, uan, line, record_ids)
           VALUES ($1, app.current_school_id(), $2, $3, $4::jsonb, $5::bigint[])`,
          [
            id,
            m.employeeId,
            m.uan,
            JSON.stringify({ ...shaped, problems: undefined, warnings: undefined }),
            m.recordIds,
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.ecr.filed',
        entityType: 'payroll_returns',
        entityId: id,
        after: { month: dto.month, seq: ecr.seq, ackNo: dto.ackNo, members: ecr.next.length },
      });
      return { id, seq: ecr.seq, members: ecr.next.length };
    });
  }

  /** A filed ECR as it was filed (from its stored lines). */
  async returnFile(ctx: RequestContext, id: string, part: 'main' | 'arrear') {
    must(ctx, RUN.approve, 'Only a payroll checker downloads the ECR');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ month: string; seq: number }>(
          `SELECT to_char(month, 'YYYY-MM') AS month, seq FROM payroll_returns WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      const lines = (
        await c.query<{ line: ReturnType<PayrollStatutoryService['shapeMember']> }>(
          `SELECT m.line FROM payroll_return_members m WHERE m.return_id = $1 ORDER BY m.line->>'name', m.line->>'code'`,
          [id],
        )
      ).rows.map(({ line: l }) => ({
        employeeId: l.employeeId,
        code: l.code,
        name: l.name,
        uan: l.uan,
        recordIds: [],
        line: {
          gross: BigInt(l.gross),
          epf: BigInt(l.epf),
          eps: BigInt(l.eps),
          edli: BigInt(l.edli),
          ee: BigInt(l.ee),
          epsShare: BigInt(l.epsShare),
          diff: BigInt(l.diff),
          ncp: BigInt(l.ncp),
        },
        arrear: l.arrear
          ? {
              epf: BigInt(l.arrear.epf!),
              eps: BigInt(l.arrear.eps!),
              edli: BigInt(l.arrear.edli!),
              ee: BigInt(l.arrear.ee!),
              epsShare: BigInt(l.arrear.epsShare!),
              diff: BigInt(l.arrear.diff!),
            }
          : null,
        problems: [],
        warnings: [],
      }));
      const text = part === 'arrear' ? ecrArrearText(lines) : ecrText(lines);
      if (!text) bad('No arrear file in this return', 409);
      return {
        filename: `ECR_${part === 'arrear' ? 'ARREAR_' : ''}${fileMonth(r!.month)}${r!.seq > 1 ? `_SUPP${String(r!.seq)}` : ''}.txt`,
        base64: Buffer.from(text, 'utf8').toString('base64'),
        contentType: 'text/plain; charset=utf-8',
      };
    });
  }

  /** A filing recorded by mistake (the payroll admin, the month's latest only, with a reason). */
  async withdraw(ctx: RequestContext, id: string, dto: WithdrawDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin withdraws a filing');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ month: string; seq: number; latest: boolean }>(
          `SELECT to_char(r.month, 'YYYY-MM') AS month, r.seq,
                  r.seq = (SELECT max(x.seq) FROM payroll_returns x WHERE x.kind = r.kind AND x.month = r.month) AS latest
             FROM payroll_returns r WHERE r.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      if (!r!.latest) bad('Only the month’s latest filing is withdrawn', 409);
      await c.query(`DELETE FROM payroll_returns WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.ecr.withdraw',
        entityType: 'payroll_returns',
        entityId: id,
        after: { month: r!.month, seq: r!.seq, reason: dto.reason },
      });
      return { ok: true };
    });
  }

  // ---- ESI ----------------------------------------------------------------------------------------------------------
  async esi(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the ESI figures');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const hidden = new Set(await hiddenFor(c, ctx));
      const shown = await this.rows(c, month, SHOWN);
      const rows = esicRows(this.esiRecords(shown), monthEnd(month));
      const runs = await this.runsOf(c, month);
      const uncovered = new Set(
        shown
          .filter((r) => r.esi_covered === false && paise(r.esi_wage) > 0n)
          .map((r) => r.employee_id),
      ).size;
      const ee = rows.reduce((s, r) => s + paise(r.ee), 0n);
      const er = rows.reduce((s, r) => s + paise(r.er), 0n);
      return {
        month,
        monthWords: monthWords(month),
        provisional: runs.some((r) => r.stage === 'APPROVED'),
        esiCode: st.esi_code,
        rows: rows.filter((r) => !hidden.has(r.employeeId)),
        hiddenCount: rows.filter((r) => hidden.has(r.employeeId)).length,
        uncovered,
        challan: {
          employees: rows.length,
          wages: String(rows.reduce((s, r) => s + BigInt(r.wages), 0n)),
          ee: rupees(ee),
          er: rupees(er),
          total: rupees(ee + er),
        },
        problems: rows
          .filter((r) => r.problems.length)
          .map((r) => ({ code: r.code, problems: r.problems })),
        can: { file: has(ctx, RUN.approve) },
      };
    });
  }

  /** The ESIC portal's monthly upload (Excel): locked runs only, covered staff only. */
  async esicUpload(ctx: RequestContext, month: string) {
    must(ctx, RUN.approve, 'Only a payroll checker downloads the ESIC upload');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = esicRows(this.esiRecords(await this.rows(c, month, FINAL)), monthEnd(month));
      if (!rows.length) bad(`${monthWords(month)} has no locked run with ESI-covered staff`, 409);
      const blocked = rows.filter((r) => r.problems.length);
      if (blocked.length)
        bad(
          `Fix these first (the portal refuses the file): ${blocked
            .slice(0, 10)
            .map((r) => `${r.code} (${r.problems.join('; ')})`)
            .join(', ')}${blocked.length > 10 ? ' …' : ''}`,
          409,
        );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.columns = [
        { header: 'IP Number (10 Digits)', width: 18, style: { numFmt: '@' } },
        { header: 'IP Name ( Only alphabets and space )', width: 34 },
        { header: 'No of Days for which wages paid/payable during the month', width: 18 },
        { header: 'Total Monthly Wages', width: 16 },
        {
          header:
            'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)',
          width: 22,
        },
        {
          header: 'Last Working Day ( Format DD/MM/YYYY  or DD-MM-YYYY)',
          width: 20,
          style: { numFmt: '@' },
        },
      ];
      for (const r of rows)
        ws.addRow([r.ip, r.name, r.days, Number(r.wages), r.reason, r.lastDay ?? '']);
      ws.getColumn(1).eachCell((cell) => {
        cell.numFmt = '@';
      });
      await this.audit.stage(ctx, c, {
        action: 'payroll.esic.download',
        entityType: 'payroll_records',
        after: { month, rows: rows.length },
      });
      return {
        filename: `ESIC_${fileMonth(month)}.xlsx`,
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    });
  }

  // ---- profession tax ------------------------------------------------------------------------------------------------
  async pt(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the profession tax');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const shown = await this.rows(c, month, SHOWN);
      const runs = await this.runsOf(c, month);
      const groups = new Map<string, { men: number; women: number; tax: bigint }>();
      for (const r of shown) {
        if (r.is_top_up && paise(r.pt_amount) === 0n) continue;
        const k = rupees(paise(r.pt_amount));
        const g = groups.get(k) ?? { men: 0, women: 0, tax: 0n };
        if ((r.gender ?? '').toLowerCase().startsWith('f')) g.women += 1;
        else g.men += 1;
        g.tax += paise(r.pt_amount);
        groups.set(k, g);
      }
      const rows = [...groups.entries()]
        .sort((a, b) => Number(paise(a[0]) - paise(b[0])))
        .map(([rate, g]) => ({
          rate,
          men: g.men,
          women: g.women,
          employees: g.men + g.women,
          tax: rupees(g.tax),
        }));
      const total = rows.reduce((s, r) => s + paise(r.tax), 0n);
      const employees = rows.filter((r) => paise(r.rate) > 0n).reduce((s, r) => s + r.employees, 0);
      const slabs = st.state_code
        ? (
            await c.query(
              `SELECT gender, wage_from::text, wage_to::text, monthly_amount::text, month_overrides
                 FROM payroll_pt_slabs
                WHERE state_code = $1 AND status = 'active' AND effective_from <= $3::date
                  AND (effective_to IS NULL OR effective_to >= $2::date)
                ORDER BY gender, wage_from`,
              [st.state_code, firstOf(month), monthEnd(month)],
            )
          ).rows
        : [];
      return {
        month,
        monthWords: monthWords(month),
        provisional: runs.some((r) => r.stage === 'APPROVED'),
        state: st.state_code,
        rows,
        employees,
        total: rupees(total),
        slabs,
        formIIIB:
          st.state_code === 'MH'
            ? {
                ptrcNo: st.ptrc_no,
                period: month,
                rows: rows.filter((r) => paise(r.rate) > 0n),
                employees,
                totalTax: rupees(total),
              }
            : null,
      };
    });
  }

  // ---- LWF ----------------------------------------------------------------------------------------------------------
  async lwf(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the LWF');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await this.settings(c);
      const hidden = new Set(await hiddenFor(c, ctx));
      const shown = await this.rows(c, month, SHOWN);
      const runs = await this.runsOf(c, month);
      const by = new Map<
        string,
        { code: string; name: string; state: string | null; ee: bigint; er: bigint; id: string }
      >();
      for (const r of shown) {
        if (paise(r.lwf_ee) + paise(r.lwf_er) === 0n) continue;
        const x = by.get(r.employee_id) ?? {
          id: r.employee_id,
          code: r.employee_code,
          name: r.employee_name,
          state: r.lwf_state,
          ee: 0n,
          er: 0n,
        };
        x.ee += paise(r.lwf_ee);
        x.er += paise(r.lwf_er);
        by.set(r.employee_id, x);
      }
      const all = [...by.values()];
      const rule = st.state_code
        ? (
            await c.query<{ frequency: string; months: number[] | null }>(
              `SELECT frequency, months FROM payroll_lwf_settings
                WHERE state_code = $1 AND status = 'active' AND effective_from <= $3::date
                  AND (effective_to IS NULL OR effective_to >= $2::date)
                ORDER BY effective_from DESC LIMIT 1`,
              [st.state_code, firstOf(month), monthEnd(month)],
            )
          ).rows[0]
        : undefined;
      const m = Number(month.slice(5, 7));
      const ee = all.reduce((s, r) => s + r.ee, 0n);
      const er = all.reduce((s, r) => s + r.er, 0n);
      return {
        month,
        monthWords: monthWords(month),
        provisional: runs.some((r) => r.stage === 'APPROVED'),
        enabled: st.lwf_enabled,
        state: st.state_code,
        frequency: rule?.frequency ?? null,
        dueMonths: rule?.months ?? null,
        due: !!rule && (rule.frequency === 'monthly' || (rule.months ?? []).includes(m)),
        rows: all
          .filter((r) => !hidden.has(r.id))
          .map((r) => ({
            code: r.code,
            name: r.name,
            state: r.state,
            ee: rupees(r.ee),
            er: rupees(r.er),
            total: rupees(r.ee + r.er),
          })),
        hiddenCount: all.filter((r) => hidden.has(r.id)).length,
        challan: { employees: all.length, ee: rupees(ee), er: rupees(er), total: rupees(ee + er) },
      };
    });
  }

  // ---- registers on paper ----------------------------------------------------------------------------------------
  private async logo(c: PoolClient) {
    const head = await registerLetterhead(c);
    let logo: LetterheadLogo | null = null;
    if (head.file)
      try {
        logo = {
          contentType: head.file.content_type,
          bytes: await this.storage.read(head.file.object_key),
        };
      } catch {
        logo = null;
      }
    return { head, logo };
  }

  /** A register as Excel or PDF: the letterhead, PROVISIONAL while an approved run is not locked, the totals. */
  async registerFile(
    ctx: RequestContext,
    month: string,
    kind: 'pf' | 'esi' | 'pt' | 'lwf',
    format: 'xlsx' | 'pdf',
  ) {
    const t = await this.registerTable(ctx, month, kind);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { head, logo } = await this.logo(c);
      const subtitle = [...(t.provisional ? [PROVISIONAL_NOTE] : []), ...t.details.slice(1)];
      const name = `${kind.toUpperCase()}_REGISTER_${fileMonth(month)}`;
      if (format === 'pdf') {
        const pdf = await tablePdf({
          school: head.school,
          address: head.address,
          title: t.title,
          letterhead: { logo, details: t.details[0] },
          subtitle,
          columns: t.columns.map((col) => ({
            label: col.label,
            width: col.width,
            right: col.right,
          })),
          rows: [...t.rows, t.total],
          strong: [t.rows.length],
          shade: { [t.rows.length]: 'total' },
          rowCount: t.rows.length,
          after: t.after,
          signs: await preparedChecked(c, (k) => this.storage.read(k)),
        });
        return {
          filename: `${name}.pdf`,
          base64: Buffer.from(pdf).toString('base64'),
          contentType: 'application/pdf',
        };
      }
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(t.title.slice(0, 31));
      ws.addRow([head.school]).font = { bold: true, size: 13 };
      ws.addRow([t.title]).font = { bold: true };
      for (const s of [...t.details.slice(0, 1), ...subtitle]) ws.addRow([s]);
      ws.addRow([]);
      const hr = ws.addRow(t.columns.map((col) => col.label));
      hr.font = { bold: true };
      for (const r of t.rows)
        ws.addRow(
          r.map((v, i) => (t.columns[i]!.number && v !== '' && v !== null ? Number(v) : v)),
        );
      const tr = ws.addRow(
        t.total.map((v, i) => (t.columns[i]!.number && v !== '' && v !== null ? Number(v) : v)),
      );
      tr.font = { bold: true };
      t.columns.forEach((col, i) => {
        ws.getColumn(i + 1).width = Math.max(10, Math.round(col.width * 120));
        if (col.text) ws.getColumn(i + 1).numFmt = '@';
      });
      for (const a of t.after ?? []) {
        ws.addRow([]);
        ws.addRow([a.title]).font = { bold: true };
        ws.addRow(a.columns.map((x) => x.label)).font = { bold: true };
        for (const r of a.rows) ws.addRow(r);
      }
      return {
        filename: `${name}.xlsx`,
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    });
  }

  private async registerTable(
    ctx: RequestContext,
    month: string,
    kind: 'pf' | 'esi' | 'pt' | 'lwf',
  ) {
    type Col = { label: string; width: number; right?: boolean; number?: boolean; text?: boolean };
    const num = (label: string, width = 0.08): Col => ({ label, width, right: true, number: true });
    if (kind === 'pf') {
      const d = await this.pf(ctx, month);
      const cols: Col[] = [
        { label: 'UAN', width: 0.11, text: true },
        { label: 'Name', width: 0.2 },
        num('Gross'),
        num('EPF wages'),
        num('EPS wages'),
        num('EDLI wages'),
        num('Employee PF (incl. VPF)', 0.1),
        num('Pension (EPS)'),
        num('Employer difference', 0.09),
        num('NCP days', 0.06),
      ];
      return {
        title: `PF register — ${d.monthWords}`,
        provisional: d.provisional,
        details: [`PF code: ${d.pfCode ?? 'not set'} · ${String(d.totals.members)} member(s)`],
        columns: cols,
        rows: d.members.map((m) => [
          m.uan,
          m.name,
          m.gross,
          m.epf,
          m.eps,
          m.edli,
          m.ee,
          m.epsShare,
          m.diff,
          m.ncp,
        ]),
        total: [
          '',
          'TOTAL',
          d.totals.gross,
          d.totals.epf,
          d.totals.eps,
          d.totals.edli,
          d.totals.ee,
          d.totals.epsShare,
          d.totals.diff,
          '',
        ],
        after: [
          {
            title: 'PF challan',
            columns: [
              { label: 'Account', width: 0.6 },
              { label: 'Amount (Rs.)', width: 0.4, right: true },
            ],
            rows: [
              ['A/c 1 — employee share, VPF and employer difference', d.challan.ac1],
              [
                `A/c 2 — admin charges${d.challan.adminMinApplied ? ' (the minimum)' : ''}`,
                d.challan.ac2,
              ],
              ['A/c 10 — pension', d.challan.ac10],
              [`A/c 21 — EDLI${d.challan.edliMinApplied ? ' (the minimum)' : ''}`, d.challan.ac21],
              ['A/c 22', d.challan.ac22],
              ['Total', d.challan.total],
            ],
            total: true,
          },
        ],
      };
    }
    if (kind === 'esi') {
      const d = await this.esi(ctx, month);
      return {
        title: `ESI contribution — ${d.monthWords}`,
        provisional: d.provisional,
        details: [
          `ESI code: ${d.esiCode ?? 'not set'} · ${String(d.challan.employees)} covered employee(s)`,
        ],
        columns: [
          { label: 'IP number', width: 0.12, text: true },
          { label: 'Name', width: 0.24 },
          num('Days', 0.06),
          num('ESI wages', 0.1),
          num('Employee', 0.1),
          num('Employer', 0.1),
          num('Reason', 0.07),
          { label: 'Last working day', width: 0.12 },
        ] as Col[],
        rows: d.rows.map((r) => [
          r.ip,
          r.name,
          r.days,
          r.wages,
          r.ee,
          r.er,
          r.reason,
          r.lastDay ?? '',
        ]),
        total: ['', 'TOTAL', '', d.challan.wages, d.challan.ee, d.challan.er, '', ''],
        after: [
          {
            title: 'ESI challan',
            columns: [
              { label: 'Figure', width: 0.6 },
              { label: 'Amount (Rs.)', width: 0.4, right: true },
            ],
            rows: [
              ['Employee share', d.challan.ee],
              ['Employer share', d.challan.er],
              ['Total', d.challan.total],
            ],
            total: true,
          },
        ],
      };
    }
    if (kind === 'pt') {
      const d = await this.pt(ctx, month);
      return {
        title: `Profession tax register — ${d.monthWords}`,
        provisional: d.provisional,
        details: [`State: ${d.state ?? 'not set'} · ${String(d.employees)} employee(s) paying`],
        columns: [
          num('Monthly rate (Rs.)', 0.2),
          num('Men', 0.15),
          num('Women', 0.15),
          num('Employees', 0.2),
          num('Tax (Rs.)', 0.3),
        ] as Col[],
        rows: d.rows.map((r) => [r.rate, r.men, r.women, r.employees, r.tax]),
        total: ['TOTAL', '', '', d.employees, d.total],
        after: undefined,
      };
    }
    const d = await this.lwf(ctx, month);
    return {
      title: `Labour welfare fund — ${d.monthWords}`,
      provisional: d.provisional,
      details: [
        `State: ${d.state ?? 'not set'}${d.enabled ? '' : ' · LWF is switched off in Settings'}${d.due ? '' : ' · not a due month'}`,
      ],
      columns: [
        { label: 'Emp. ID', width: 0.15 },
        { label: 'Name', width: 0.35 },
        { label: 'State', width: 0.1 },
        num('Employee', 0.13),
        num('Employer', 0.13),
        num('Total', 0.14),
      ] as Col[],
      rows: d.rows.map((r) => [r.code, r.name, r.state ?? '', r.ee, r.er, r.total]),
      total: ['', 'TOTAL', '', d.challan.ee, d.challan.er, d.challan.total],
      after: undefined,
    };
  }
}
