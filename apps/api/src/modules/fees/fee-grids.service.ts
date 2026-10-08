/* eslint-disable no-restricted-syntax -- SQL fragments here are constants assembled in code; every value is a bound parameter */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { FeeSetupService } from './fee-setup.service';
import type { SetClassRulesDto } from './fees.dto';

export interface StructureGrid {
  classId: string;
  className: string;
  feeGroup: string;
  studentType: 'all' | 'new' | 'old';
  months: Array<{ sequence: number; name: string; instalment: number }>;
  rows: Array<{ headId: string; code: string; name: string; optional: boolean; amounts: string[] }>;
  monthTotals: string[];
  total: string;
  /** Fee groups that have a structure for the class, and the student types of this group. */
  groups: string[];
}
export interface DiscountGrid {
  discount: { id: string; code: string; name: string };
  rows: Array<{
    headId: string;
    code: string;
    name: string;
    percent: string | null;
    amount: string | null;
  }>;
}
type Key = { classId: string; feeGroup: string; studentType: 'all' | 'new' | 'old' };

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const num = (v: string): number | null => {
  const s = v.replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const toDate = (v: string): string | null => {
  const s = v.trim();
  if (s === '') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : 'bad';
};
const dmy = (iso: string | null) =>
  iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : '';

/**
 * The fee set-up grids (0103): the class fee structure month by month, a discount head by head, and the
 * Excel / PDF files of these and of the class calendar. The Excel that is downloaded is the one that is
 * uploaded: correct it and send it back.
 */
@Injectable()
export class FeeGridsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly setup: FeeSetupService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  // ---- class fee structure --------------------------------------------------------------------------
  private async structureWith(c: PoolClient, yearId: string, k: Key): Promise<StructureGrid> {
    const cls = await c.query<{ name: string }>(`SELECT name FROM classes WHERE id = $1`, [
      k.classId,
    ]);
    if (!cls.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
    const months = await c.query<{ sequence: number; name: string; instalment: number }>(
      `SELECT sequence, name, instalment FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
      [yearId],
    );
    if (months.rowCount === 0)
      throw new DomainError('fees.no_periods', 'Create the twelve months of the year first', {
        status: 409,
      });
    // a row kept the old way (one amount and a frequency) is spread over its months
    const rows = await c.query<{
      headId: string;
      code: string;
      name: string;
      optional: boolean;
      amounts: string[] | null;
    }>(
      `SELECT h.id::text AS "headId", h.code, h.name, h.is_optional AS optional,
              (SELECT array_agg(COALESCE(
                        CASE WHEN fs.amounts IS NOT NULL THEN fs.amounts[m]
                             WHEN fs.periods IS NOT NULL THEN CASE WHEN m = ANY(fs.periods) THEN fs.amount END
                             WHEN fs.frequency = 'monthly' THEN fs.amount
                             WHEN fs.frequency = 'quarterly' THEN CASE WHEN m IN (1, 4, 7, 10) THEN fs.amount END
                             WHEN fs.frequency = 'half_yearly' THEN CASE WHEN m IN (1, 7) THEN fs.amount END
                             ELSE CASE WHEN m = 1 THEN fs.amount END END, 0)::numeric(12,2)::text ORDER BY m)
                 FROM generate_series(1, 12) m) AS amounts
         FROM fee_heads h
         LEFT JOIN fee_structures fs ON fs.head_id = h.id AND fs.academic_year_id = $1 AND fs.class_id = $2 AND fs.fee_group = $3 AND fs.student_type = $4
        WHERE h.deleted_at IS NULL AND h.status = 'active' AND h.kind IN ('regular', 'misc')
        ORDER BY h.sort_order, h.code`,
      [yearId, k.classId, k.feeGroup, k.studentType],
    );
    const groups = await c.query<{ g: string }>(
      `SELECT DISTINCT fee_group AS g FROM fee_structures WHERE academic_year_id = $1 ORDER BY 1`,
      [yearId],
    );
    const grid = rows.rows.map((r) => ({
      ...r,
      amounts: r.amounts ?? Array<string>(12).fill('0.00'),
    }));
    const monthTotals = Array.from({ length: 12 }, (_, i) =>
      grid.reduce((a, r) => a + Number(r.amounts[i]), 0).toFixed(2),
    );
    return {
      classId: k.classId,
      className: cls.rows[0].name,
      feeGroup: k.feeGroup,
      studentType: k.studentType,
      months: months.rows,
      rows: grid,
      monthTotals,
      total: monthTotals.reduce((a, v) => a + Number(v), 0).toFixed(2),
      groups: [...new Set(['general', ...groups.rows.map((x) => x.g), k.feeGroup])],
    };
  }

  async structure(ctx: RequestContext, k: Key): Promise<StructureGrid> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => this.structureWith(c, yearId, k));
  }

  private async saveStructureWith(
    c: PoolClient,
    yearId: string,
    k: Key,
    rows: Array<{ headId: string; amounts: number[] }>,
  ): Promise<void> {
    await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
    for (const r of rows) {
      if (r.amounts.length !== 12 || r.amounts.some((a) => !(a >= 0)))
        throw new DomainError('validation-failed', 'Each head needs twelve amounts of 0 or more', {
          status: 422,
        });
      if (r.amounts.every((a) => a === 0)) {
        await c.query(
          `DELETE FROM fee_structures WHERE academic_year_id = $1 AND class_id = $2 AND head_id = $3 AND fee_group = $4 AND student_type = $5`,
          [yearId, k.classId, r.headId, k.feeGroup, k.studentType],
        );
        continue;
      }
      await c.query(
        `INSERT INTO fee_structures (school_id, academic_year_id, class_id, head_id, fee_group, student_type, amount, frequency, periods, amounts, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'monthly', NULL, $7::numeric(12,2)[], app.current_user_id(), app.current_user_id())
         ON CONFLICT (academic_year_id, class_id, head_id, fee_group, student_type)
         DO UPDATE SET amount = EXCLUDED.amount, frequency = 'monthly', periods = NULL, amounts = EXCLUDED.amounts, updated_at = now(), updated_by = app.current_user_id()`,
        [
          yearId,
          k.classId,
          r.headId,
          k.feeGroup,
          k.studentType,
          Math.max(...r.amounts).toFixed(2),
          r.amounts.map((a) => a.toFixed(2)),
        ],
      );
    }
  }

  async saveStructure(
    ctx: RequestContext,
    k: Key,
    rows: Array<{ headId: string; amounts: number[] }>,
  ): Promise<StructureGrid> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.saveStructureWith(c, yearId, k, rows);
      await this.audit.stage(ctx, c, {
        action: 'fees.structure.set',
        entityType: 'fee_structures',
        entityId: k.classId,
        after: { ...k, heads: rows.length },
      });
      return this.structureWith(c, yearId, k);
    });
  }

  /** Copies this class's structure (one fee group and student type) onto other classes, replacing theirs. */
  async cloneStructure(ctx: RequestContext, k: Key, toClassIds: string[]) {
    const yearId = this.year(ctx);
    const targets = [...new Set(toClassIds)].filter((id) => id !== k.classId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const ok = await c.query(`SELECT id FROM classes WHERE id = ANY($1::bigint[])`, [targets]);
      if (ok.rowCount !== targets.length)
        throw new DomainError('not-found', 'Class not found', { status: 404 });
      for (const to of targets) {
        await c.query(
          `DELETE FROM fee_structures WHERE academic_year_id = $1 AND class_id = $2 AND fee_group = $3 AND student_type = $4`,
          [yearId, to, k.feeGroup, k.studentType],
        );
        await c.query(
          `INSERT INTO fee_structures (school_id, academic_year_id, class_id, head_id, fee_group, student_type, amount, frequency, periods, amounts, created_by, updated_by)
           SELECT school_id, academic_year_id, $5, head_id, fee_group, student_type, amount, frequency, periods, amounts, app.current_user_id(), app.current_user_id()
             FROM fee_structures WHERE academic_year_id = $1 AND class_id = $2 AND fee_group = $3 AND student_type = $4`,
          [yearId, k.classId, k.feeGroup, k.studentType, to],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.structure.clone',
        entityType: 'fee_structures',
        entityId: k.classId,
        after: { ...k, toClassIds: targets },
      });
      return { cloned: targets.length };
    });
  }

  async structureFile(ctx: RequestContext, k: Key, format: 'xlsx' | 'pdf') {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.structureWith(c, yearId, k);
      const name = `fee-structure-${g.className.replace(/\s+/g, '-')}-${k.feeGroup}-${k.studentType}`;
      if (format === 'xlsx')
        return {
          filename: `${name}.xlsx`,
          contentType: XLSX,
          bytes: await templateSheet({
            sheet: 'Fee structure',
            columns: [
              { header: 'Head code', width: 14, required: true },
              { header: 'Fee head', width: 28 },
              ...g.months.map((m) => ({ header: m.name.split(' ')[0]!, width: 11 })),
            ],
            rows: g.rows.map((r) => [r.code, r.name, ...r.amounts.map(Number)]),
            guide: [
              `Class ${g.className}, fee group "${k.feeGroup}", student type "${k.studentType}".`,
              'One row per fee head; do not change the head code. Type the amount of each month; 0 or empty means not charged that month.',
              'Upload this same file on the Class fee structure tab. It replaces the amounts of the heads in the file.',
            ],
          }),
        };
      const head = await schoolHead(c);
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Class fee structure',
          details: [
            `Class ${g.className}`,
            `Fee group: ${k.feeGroup.replace(/_/g, ' ')}`,
            `Student type: ${k.studentType}`,
            `Year total ₹${g.total}`,
            generatedOn(),
          ],
          legend: 'Amounts in rupees; 0 = not charged that month.',
          columns: [
            { label: 'Fee head', width: 26 },
            ...g.months.map((m) => ({ label: m.name.slice(0, 3), width: 9, right: true })),
            { label: 'Total', width: 11, right: true },
          ],
          rows: [
            ...g.rows.map((r) => [
              r.name,
              ...r.amounts,
              r.amounts.reduce((a, v) => a + Number(v), 0).toFixed(2),
            ]),
            ['Total', ...g.monthTotals, g.total],
          ],
          filename: name,
        },
        'pdf',
      );
    });
  }

  async importStructure(ctx: RequestContext, k: Key, fileBase64: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.structureWith(c, yearId, k);
      const monthCols = g.months.map((m) => m.name.split(' ')[0]!);
      const sheet = await readSheet(fileBase64, ['Head code', ...monthCols]);
      const byCode = new Map(g.rows.map((r) => [r.code.toUpperCase(), r.headId]));
      const bad: Array<{ row: number; error: string }> = [];
      const rows: Array<{ headId: string; amounts: number[] }> = [];
      for (const line of sheet) {
        const code = line.cells['Head code']!.trim().toUpperCase();
        const headId = byCode.get(code);
        const amounts = monthCols.map((m) => num(line.cells[m]!) ?? 0);
        if (!headId) bad.push({ row: line.row, error: `Head code ${code || '(empty)'} not found` });
        else if (amounts.some((a) => Number.isNaN(a)))
          bad.push({ row: line.row, error: `${code}: an amount is not a number of 0 or more` });
        else rows.push({ headId, amounts });
      }
      if (bad.length === 0) {
        await this.saveStructureWith(c, yearId, k, rows);
        await this.audit.stage(ctx, c, {
          action: 'fees.structure.import',
          entityType: 'fee_structures',
          entityId: k.classId,
          after: { ...k, heads: rows.length },
        });
      }
      return { rows: sheet.length, saved: bad.length === 0 ? rows.length : 0, bad };
    });
  }

  // ---- discount head by head ------------------------------------------------------------------------
  private async discountWith(c: PoolClient, yearId: string, id: string): Promise<DiscountGrid> {
    const d = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM fee_discounts WHERE id = $1 AND academic_year_id = $2`,
      [id, yearId],
    );
    if (!d.rows[0])
      throw new DomainError('not-found', 'Discount not found in this year', { status: 404 });
    const rows = await c.query<DiscountGrid['rows'][number]>(
      `SELECT h.id::text AS "headId", h.code, h.name, l.percent::text, l.amount::text
         FROM fee_heads h LEFT JOIN fee_discount_lines l ON l.head_id = h.id AND l.discount_id = $1
        WHERE h.deleted_at IS NULL AND h.status = 'active' AND h.kind IN ('regular', 'misc', 'transport')
        ORDER BY h.sort_order, h.code`,
      [id],
    );
    return { discount: d.rows[0], rows: rows.rows };
  }

  async discount(ctx: RequestContext, id: string): Promise<DiscountGrid> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => this.discountWith(c, yearId, id));
  }

  private async saveDiscountWith(
    c: PoolClient,
    id: string,
    rows: Array<{ headId: string; percent?: number | null; amount?: number | null }>,
  ): Promise<void> {
    for (const r of rows) {
      const pct = r.percent ?? 0;
      const amt = r.amount ?? 0;
      if (pct > 0 && amt > 0)
        throw new DomainError(
          'validation-failed',
          'Give a percentage or a fixed amount for a head, not both',
          { status: 422 },
        );
      if (pct > 100)
        throw new DomainError('validation-failed', 'A percentage cannot be more than 100', {
          status: 422,
        });
      if (pct <= 0 && amt <= 0) {
        await c.query(`DELETE FROM fee_discount_lines WHERE discount_id = $1 AND head_id = $2`, [
          id,
          r.headId,
        ]);
        continue;
      }
      await c.query(
        `INSERT INTO fee_discount_lines (school_id, discount_id, head_id, percent, amount, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
         ON CONFLICT (discount_id, head_id) DO UPDATE SET percent = EXCLUDED.percent, amount = EXCLUDED.amount, updated_at = now(), updated_by = app.current_user_id()`,
        [id, r.headId, pct > 0 ? pct : null, pct > 0 ? null : amt],
      );
    }
  }

  async saveDiscount(
    ctx: RequestContext,
    id: string,
    rows: Array<{ headId: string; percent?: number | null; amount?: number | null }>,
  ): Promise<DiscountGrid> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      await this.discountWith(c, yearId, id);
      await this.saveDiscountWith(c, id, rows);
      await this.audit.stage(ctx, c, {
        action: 'fees.discount.lines',
        entityType: 'fee_discounts',
        entityId: id,
        after: { heads: rows.length },
      });
      return this.discountWith(c, yearId, id);
    });
  }

  async discountFile(ctx: RequestContext, id: string, format: 'xlsx' | 'pdf') {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.discountWith(c, yearId, id);
      const name = `discount-${g.discount.code}`;
      if (format === 'xlsx')
        return {
          filename: `${name}.xlsx`,
          contentType: XLSX,
          bytes: await templateSheet({
            sheet: 'Discount',
            columns: [
              { header: 'Head code', width: 14, required: true },
              { header: 'Fee head', width: 28 },
              { header: 'Percentage', width: 12 },
              { header: 'Fix amount', width: 12 },
            ],
            rows: g.rows.map((r) => [
              r.code,
              r.name,
              r.percent === null ? null : Number(r.percent),
              r.amount === null ? null : Number(r.amount),
            ]),
            guide: [
              `Discount "${g.discount.name}" (${g.discount.code}).`,
              'One row per fee head; do not change the head code. Give a percentage or a fixed amount per month, not both. Empty = no discount on that head.',
              'Upload this same file on the Discount by head tab.',
            ],
          }),
        };
      const head = await schoolHead(c);
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: `Discount: ${g.discount.name}`,
          details: [`Code ${g.discount.code}`, generatedOn()],
          legend: 'Percentage of the head, or a fixed amount per month.',
          columns: [
            { label: 'Fee head', width: 34 },
            { label: 'Percentage (%)', width: 16, right: true },
            { label: 'Fix amount (₹)', width: 16, right: true },
          ],
          rows: g.rows.map((r) => [r.name, r.percent ?? '', r.amount ?? '']),
          filename: name,
        },
        'pdf',
      );
    });
  }

  async importDiscount(ctx: RequestContext, id: string, fileBase64: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const g = await this.discountWith(c, yearId, id);
      const sheet = await readSheet(fileBase64, ['Head code', 'Percentage', 'Fix amount']);
      const byCode = new Map(g.rows.map((r) => [r.code.toUpperCase(), r.headId]));
      const bad: Array<{ row: number; error: string }> = [];
      const rows: Array<{ headId: string; percent: number | null; amount: number | null }> = [];
      for (const line of sheet) {
        const code = line.cells['Head code']!.trim().toUpperCase();
        const headId = byCode.get(code);
        const percent = num(line.cells['Percentage']!);
        const amount = num(line.cells['Fix amount']!);
        if (!headId) bad.push({ row: line.row, error: `Head code ${code || '(empty)'} not found` });
        else if (Number.isNaN(percent) || Number.isNaN(amount) || (percent ?? 0) > 100)
          bad.push({ row: line.row, error: `${code}: percentage (0–100) or amount is not valid` });
        else if ((percent ?? 0) > 0 && (amount ?? 0) > 0)
          bad.push({ row: line.row, error: `${code}: give a percentage or an amount, not both` });
        else rows.push({ headId, percent, amount });
      }
      if (bad.length === 0) await this.saveDiscountWith(c, id, rows);
      return { rows: sheet.length, saved: bad.length === 0 ? rows.length : 0, bad };
    });
  }

  // ---- class calendar files -------------------------------------------------------------------------
  private static readonly CAL = [
    'Month no.',
    'Month',
    'Quarter',
    'Start fees date',
    'Last fees date',
    'Late fees',
    'Last date 1',
    'Late fee 1',
    'Last date 2',
    'Late fee 2',
    'Last date 3',
    'Late fee 3',
    'Challan date',
    'Bounce',
    'Fee pay',
    'Show',
  ];

  async calendarFile(ctx: RequestContext, classId: string, format: 'xlsx' | 'pdf') {
    const rules = await this.setup.classRules(ctx, classId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cls = await c.query<{ name: string }>(`SELECT name FROM classes WHERE id = $1`, [
        classId,
      ]);
      const className = cls.rows[0]?.name ?? classId;
      const name = `fee-calendar-${className.replace(/\s+/g, '-')}`;
      const line = (p: (typeof rules.periods)[number], forFile: boolean) => {
        const d = (iso: string | null) => (forFile ? dmy(iso) : dmy(iso));
        return [
          p.sequence,
          p.name,
          p.instalment ?? (forFile ? '' : `Q${p.schoolInstalment}`),
          d(p.startOn),
          d(p.dueOn) || (forFile ? '' : dmy(p.schoolDueOn)),
          p.lateFeeAmount ?? '',
          d(p.slabs[0]?.on ?? null),
          p.slabs[0]?.amount ?? '',
          d(p.slabs[1]?.on ?? null),
          p.slabs[1]?.amount ?? '',
          d(p.slabs[2]?.on ?? null),
          p.slabs[2]?.amount ?? '',
          d(p.challanOn),
          p.bounceCharge ?? '',
          p.feePay ? 'Yes' : 'No',
          p.show ? 'Yes' : 'No',
        ];
      };
      if (format === 'xlsx')
        return {
          filename: `${name}.xlsx`,
          contentType: XLSX,
          bytes: await templateSheet({
            sheet: 'Fee calendar',
            columns: FeeGridsService.CAL.map((h, i) => ({
              header: h,
              width: i === 1 ? 18 : 14,
              required: i === 0,
              options: h === 'Fee pay' || h === 'Show' ? ['Yes', 'No'] : undefined,
            })),
            rows: rules.periods.map((p) => line(p, true)),
            guide: [
              `Class ${className}. One row per month; do not change "Month no.".`,
              'Dates as DD-MM-YYYY. An empty box follows the school. Fee pay and Show take Yes or No.',
              'Slabs: "Late fees" applies after the last date; after "Last date 1" the fee becomes "Late fee 1", and so on.',
              'Upload this same file on the Class rules tab; it replaces the months in the file.',
            ],
          }),
        };
      const head = await schoolHead(c);
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Class fee calendar',
          details: [
            `Class ${className}`,
            `Late fee: ${rules.lateFeeMode === 'slab' ? 'by slabs' : `per day ₹${rules.classLatePerDay ?? rules.schoolLatePerDay}${rules.lateMax ? `, maximum ₹${rules.lateMax}` : ''}`}`,
            generatedOn(),
          ],
          legend: 'An empty box follows the school.',
          columns: FeeGridsService.CAL.slice(1).map((h, i) => ({
            label: h,
            width: i === 0 ? 16 : 10,
          })),
          rows: rules.periods.map((p) =>
            line(p, false)
              .slice(1)
              .map((v) => (v === null ? '' : v)),
          ),
          filename: name,
        },
        'pdf',
      );
    });
  }

  async importCalendar(ctx: RequestContext, classId: string, fileBase64: string) {
    const rules = await this.setup.classRules(ctx, classId);
    const sheet = await readSheet(
      fileBase64,
      FeeGridsService.CAL.filter((h) => h !== 'Month'),
    );
    const bySeq = new Map(rules.periods.map((p) => [p.sequence, p.periodId]));
    const bad: Array<{ row: number; error: string }> = [];
    const periods: SetClassRulesDto['periods'] = [];
    for (const line of sheet) {
      const cell = (h: string) => line.cells[h]!.trim();
      const periodId = bySeq.get(Number(cell('Month no.')));
      const dates = [
        'Start fees date',
        'Last fees date',
        'Last date 1',
        'Last date 2',
        'Last date 3',
        'Challan date',
      ].map((h) => toDate(cell(h)));
      const nums = ['Quarter', 'Late fees', 'Late fee 1', 'Late fee 2', 'Late fee 3', 'Bounce'].map(
        (h) => num(cell(h)),
      );
      if (!periodId) bad.push({ row: line.row, error: 'Month no. must be 1 to 12' });
      else if (dates.includes('bad'))
        bad.push({ row: line.row, error: 'A date is not DD-MM-YYYY' });
      else if (nums.some((n) => Number.isNaN(n)))
        bad.push({ row: line.row, error: 'A number is not valid' });
      else {
        const slabs = [1, 2, 3]
          .map((i) => ({ on: dates[i + 1]!, amount: nums[i + 1]! }))
          .filter((s): s is { on: string; amount: number } => s.on !== null && s.amount !== null);
        periods.push({
          periodId,
          instalment: nums[0] ?? null,
          startOn: dates[0],
          dueOn: dates[1],
          lateFeeAmount: nums[1] ?? null,
          slabs,
          challanOn: dates[5],
          bounceCharge: nums[5] ?? null,
          feePay: cell('Fee pay').toLowerCase() !== 'no',
          show: cell('Show').toLowerCase() !== 'no',
        });
      }
    }
    if (bad.length === 0 && periods.length > 0)
      await this.setup.setClassRules(ctx, classId, { periods });
    return { rows: sheet.length, saved: bad.length === 0 ? periods.length : 0, bad };
  }
}
