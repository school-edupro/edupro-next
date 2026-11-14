import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import { preparedChecked } from '../leave/leave-report-file';
import { PayrollBankService } from './payroll-bank.service';
import { PayrollGoLiveService } from './payroll-golive.service';
import { PayrollHeadsService } from './payroll-heads.service';
import { RUN } from './payroll-inputs.dto';
import { bad, has } from './payroll-month';
import { PayrollPeopleService } from './payroll-people.service';
import { gridPdf, gridSheet, type Grid, type GridCol, type GridRow } from './payroll-report-grid';
import { PayrollReportsService } from './payroll-reports.service';
import { PayrollSetupService } from './payroll-setup.service';
import { PAYROLL, type ConfigKind } from './payroll.dto';

/**
 * Every list of the payroll set-up with a filter, pages and its Excel / PDF (docs/design/86, "Set-up lists"): one
 * catalogue — what a list loads (through the set-up's own services, so their rights, masking and confidential staff
 * hold), its filters, and its columns for a file. The screen asks for a page of the filtered rows; a download is every
 * row the filters leave, on the register letterhead with the filters under the title and the Prepared / Checked boxes,
 * recorded in the payroll audit trail. The Set-up book puts the whole set-up in one workbook (or one PDF).
 */

type Row = Record<string, unknown>;
type Params = Record<string, string>;
export interface ListFilter {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'date';
  options?: Array<{ value: string; label: string }>;
}
interface Loaded {
  rows: Row[];
  /** what the page shows besides the rows (figures, the batch, the scoreboard …) */
  extra?: Row;
  /** a title with the record's name (a head's code, an employee) */
  title?: string;
}
interface ListDef {
  key: string;
  title: string;
  noun: string;
  /** params the list cannot do without (a head's id, a kind, an employee) */
  needs?: string[];
  /** any of these rights besides the set-up view */
  rights?: string[];
  load: (ctx: RequestContext, p: Params) => Promise<Loaded>;
  filters: (rows: Row[], p: Params, extra?: Row) => ListFilter[];
  /** a big list pages in the database: the screen's page, the total the filters leave, and every row */
  pageLoad?: (
    ctx: RequestContext,
    p: Params,
    page: number,
    size: number,
  ) => Promise<{ rows: Row[]; total: number; all: number; extra?: Row; title?: string }>;
  match: (r: Row, f: Params) => boolean;
  columns: (p: Params, rows: Row[]) => GridCol[];
  cells: (r: Row, p: Params) => GridRow;
}

// ---- words and numbers as the screens show them ----------------------------------------------------------------
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dmy = (v: unknown) => {
  const d = s(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
};
const pct = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? ''
    : `${(Number(v) * 100).toLocaleString('en-IN', { maximumFractionDigits: 4 })} %`;
const inr = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? ''
    : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yes = (v: unknown) => (v ? 'Yes' : 'No');
const has1 = (hay: unknown[], needle: string) =>
  !needle || hay.some((h) => s(h).toLowerCase().includes(needle.toLowerCase()));
const opt = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));
const distinct = (rows: Row[], k: string) =>
  [...new Set(rows.map((r) => s(r[k])).filter(Boolean))]
    .sort()
    .map((v) => ({ value: v, label: v }));
const STATUS = opt([
  ['draft', 'Draft'],
  ['active', 'Active'],
  ['ended', 'Ended'],
]);
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const CATEGORY: Record<string, string> = {
  BASIC: 'Basic',
  DA: 'Dearness allowance',
  HRA: 'House rent',
  ALLOWANCE: 'Allowance',
  ARREAR: 'Arrears',
  BONUS: 'Bonus',
  REIMB: 'Reimbursement',
  LOAN: 'Loan or advance',
  STATUTORY: 'Statutory',
  MISC: 'Other',
};
const CALC: Record<string, string> = {
  FIXED: 'Fixed',
  FORMULA: 'Formula',
  SLAB: 'Slab',
  MANUAL: 'Manual',
  SYSTEM: 'System',
};
const STAFF: Record<string, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
};
const KIND_LABEL: Record<ConfigKind, string> = {
  rates: 'Rates',
  pf: 'PF',
  esi: 'ESI',
  pt: 'Profession tax',
  lwf: 'LWF',
  ot: 'Overtime rates',
};
const KINDS = Object.keys(KIND_LABEL) as ConfigKind[];
const flags = (r: Row) =>
  [
    r.pfWage && 'PF',
    r.esiWage && 'ESI',
    r.ptWage && 'PT',
    r.isTaxable && 'Tax',
    r.prorateOnLop && 'LOP',
  ]
    .filter(Boolean)
    .join(' · ');
const dated: GridCol[] = [
  { key: 'from', label: 'From', width: 0.08 },
  { key: 'to', label: 'To', width: 0.08 },
  { key: 'status', label: 'Status', width: 0.07 },
  { key: 'made', label: 'Made · approved by', width: 0.14 },
  { key: 'why', label: 'Why', width: 0.18 },
];
const datedCells = (r: Row) => ({
  from: dmy(r.effectiveFrom),
  to: r.effectiveTo ? dmy(r.effectiveTo) : 'Open',
  status: s(r.status),
  made: [r.createdByName, r.approvedByName].filter(Boolean).join(' · '),
  why: s(r.changeReason),
});
/** in force on a date: active, from on or before, to open or on or after */
const inForce = (r: Row, on: string) =>
  !on ||
  (r.status === 'active' && s(r.effectiveFrom) <= on && (!r.effectiveTo || s(r.effectiveTo) >= on));

/** The value a config row is about, as the rates screen shows it. */
const CONFIG_COLS: Record<ConfigKind, Array<{ label: string; cell: (r: Row) => string }>> = {
  rates: [
    { label: 'Code', cell: (r) => s(r.rateCode) },
    {
      label: 'Value',
      cell: (r) =>
        `${Number(r.rateValue).toLocaleString('en-IN', { maximumFractionDigits: 6 })}${s(r.rateCode).endsWith('RATE') ? ` (${pct(r.rateValue)})` : ''}`,
    },
    { label: 'Source', cell: (r) => (r.source === 'govt' ? 'Government' : 'School') },
    { label: 'Notified', cell: (r) => dmy(r.notifiedOn) },
  ],
  pf: [
    { label: 'Employee', cell: (r) => pct(r.eeRate) },
    { label: 'Employer', cell: (r) => pct(r.erRate) },
    { label: 'EPS', cell: (r) => `${pct(r.epsRate)} up to ${inr(r.epsWageCeiling)}` },
    {
      label: 'EDLI',
      cell: (r) =>
        `${pct(r.edliRate)} up to ${inr(r.edliWageCeiling)} (at least ${inr(r.edliMin)})`,
    },
    { label: 'Admin', cell: (r) => `${pct(r.adminRate)} (at least ${inr(r.adminMin)})` },
  ],
  esi: [
    { label: 'Employee', cell: (r) => pct(r.eeRate) },
    { label: 'Employer', cell: (r) => pct(r.erRate) },
    { label: 'Wage limit', cell: (r) => inr(r.wageLimit) },
    { label: 'Disability', cell: (r) => inr(r.wageLimitPwd) },
  ],
  pt: [
    { label: 'State', cell: (r) => s(r.stateCode) },
    {
      label: 'Gender',
      cell: (r) => ({ M: 'Men', F: 'Women', ANY: 'Any' })[s(r.gender)] ?? s(r.gender),
    },
    {
      label: 'Monthly wage',
      cell: (r) => `${inr(r.wageFrom)} – ${r.wageTo ? inr(r.wageTo) : 'and above'}`,
    },
    { label: 'Tax a month', cell: (r) => inr(r.monthlyAmount) },
    {
      label: 'A month differs',
      cell: (r) =>
        Object.entries((r.monthOverrides as Record<string, string> | null) ?? {})
          .map(([m, a]) => `${MONTHS[Number(m) - 1] ?? m} ${inr(a)}`)
          .join(', '),
    },
  ],
  lwf: [
    { label: 'State', cell: (r) => s(r.stateCode) },
    {
      label: 'Employee',
      cell: (r) =>
        r.eeFlat ? inr(r.eeFlat) : `${pct(r.eeRate)}${r.eeCap ? ` up to ${inr(r.eeCap)}` : ''}`,
    },
    {
      label: 'Employer',
      cell: (r) =>
        r.erFlat ? inr(r.erFlat) : r.erMultiplier ? `${s(r.erMultiplier)} × the employee` : '',
    },
    {
      label: 'When',
      cell: (r) =>
        r.frequency === 'monthly'
          ? 'Monthly'
          : `In ${((r.months as number[] | null) ?? []).map((m) => MONTHS[m - 1]).join(' and ')}`,
    },
  ],
  ot: [
    { label: 'Employee type', cell: (r) => s(r.employeeType) },
    { label: 'A day', cell: (r) => inr(r.dailyAmount) },
    { label: 'An hour', cell: (r) => inr(r.hourlyAmount) },
  ],
};
const configKind = (p: Params): ConfigKind => {
  const k = p.kind as ConfigKind;
  if (!KINDS.includes(k)) bad('Not a kind of rate', 400);
  return k;
};
/** the comparison's filters as the results query takes them */
const parityQuery = (p: Params) => ({
  ...(['OPEN', 'EXPLAINED', 'MATCH'].includes(p.status ?? '') ? { status: p.status } : {}),
  ...(/^[A-Z][A-Z0-9_]{0,29}$/.test(p.component ?? '') ? { component: p.component } : {}),
  ...(/^\d{4}-\d{2}$/.test(p.month ?? '') ? { month: p.month } : {}),
});
/** what a config draft is about, in a few words (the drafts list) */
const configWhat = (kind: ConfigKind, r: Row) =>
  kind === 'rates'
    ? `${s(r.rateCode)} = ${s(r.rateValue)}`
    : kind === 'pt' || kind === 'lwf'
      ? `${s(r.stateCode)}${r.wageFrom ? ` from ₹${s(r.wageFrom)}` : ''}`
      : kind === 'ot'
        ? s(r.employeeType)
        : KIND_LABEL[kind];

@Injectable()
export class PayrollSetupListsService {
  private readonly defs: Record<string, ListDef>;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly setup: PayrollSetupService,
    private readonly heads: PayrollHeadsService,
    private readonly people: PayrollPeopleService,
    private readonly bank: PayrollBankService,
    private readonly golive: PayrollGoLiveService,
    private readonly reports: PayrollReportsService,
  ) {
    const list: ListDef[] = [
      // ---- pay heads ----------------------------------------------------------------------------------------------
      {
        key: 'heads',
        title: 'Pay heads',
        noun: 'pay heads',
        load: async (ctx) => ({ rows: (await this.heads.heads(ctx)).heads as unknown as Row[] }),
        filters: () => [
          { key: 'q', label: 'Code or name', kind: 'text' },
          {
            key: 'type',
            label: 'Type',
            kind: 'select',
            options: opt([
              ['EARNING', 'Earnings'],
              ['DEDUCTION', 'Deductions'],
            ]),
          },
          {
            key: 'category',
            label: 'Kind',
            kind: 'select',
            options: opt(Object.entries(CATEGORY)),
          },
          {
            key: 'calc',
            label: 'Worked out',
            kind: 'select',
            options: opt([...Object.entries(CALC), ['NONE', 'None in force']]),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            options: opt([
              ['active', 'In use'],
              ['inactive', 'Not in use'],
            ]),
          },
          {
            key: 'drafts',
            label: 'Drafts',
            kind: 'select',
            options: opt([
              ['yes', 'Has a draft'],
              ['no', 'No draft'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.code, r.name], f.q ?? '') &&
          (!f.type || r.headType === f.type) &&
          (!f.category || r.category === f.category) &&
          (!f.calc || (f.calc === 'NONE' ? !r.calcType : r.calcType === f.calc)) &&
          (!f.status || r.status === f.status) &&
          (!f.drafts || (f.drafts === 'yes') === Number(r.drafts) > 0),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.09 },
          { key: 'name', label: 'Name', width: 0.16 },
          { key: 'type', label: 'Type', width: 0.08 },
          { key: 'kind', label: 'Kind', width: 0.1 },
          { key: 'calc', label: 'Worked out', width: 0.22 },
          { key: 'flags', label: 'Counts for', width: 0.1 },
          { key: 'from', label: 'In force from', width: 0.08 },
          { key: 'versions', label: 'Versions', kind: 'number', width: 0.06 },
          { key: 'drafts', label: 'Drafts', kind: 'number', width: 0.05 },
          { key: 'status', label: 'Status', width: 0.07 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          type: r.headType === 'EARNING' ? 'Earning' : 'Deduction',
          kind: CATEGORY[s(r.category)] ?? s(r.category),
          calc: `${CALC[s(r.calcType)] ?? ''}${r.formula ? ` ${s(r.formula)}` : ''}`,
          flags: flags(r),
          from: r.liveFrom ? dmy(r.liveFrom) : 'None in force',
          versions: Number(r.versions),
          drafts: Number(r.drafts),
          status: r.status === 'active' ? 'In use' : 'Not in use',
        }),
      },
      {
        key: 'head-versions',
        title: 'Pay-head versions',
        noun: 'versions',
        needs: ['id'],
        load: async (ctx, p) => {
          const h = await this.heads.head(ctx, p.id!);
          return {
            rows: h.versions as unknown as Row[],
            title: `Pay head ${h.head.code} (${h.head.name}): versions`,
          };
        },
        filters: () => [
          { key: 'status', label: 'Status', kind: 'select', options: STATUS },
          { key: 'calc', label: 'Worked out', kind: 'select', options: opt(Object.entries(CALC)) },
          { key: 'on', label: 'In force on', kind: 'date' },
        ],
        match: (r, f) =>
          (!f.status || r.status === f.status) &&
          (!f.calc || r.calcType === f.calc) &&
          inForce(r, f.on ?? ''),
        columns: () => [
          { key: 'calc', label: 'Worked out', width: 0.24 },
          { key: 'depends', label: 'Depends on', width: 0.1 },
          { key: 'flags', label: 'Counts for', width: 0.1 },
          { key: 'rounding', label: 'Rounding', width: 0.08 },
          { key: 'ref', label: 'Reference', width: 0.08 },
          ...dated,
        ],
        cells: (r) => ({
          calc: `${CALC[s(r.calcType)] ?? s(r.calcType)}${r.formula ? ` ${s(r.formula)}` : ''}`,
          depends: s(r.dependsOn),
          flags: flags(r),
          rounding: s(r.rounding),
          ref: s(r.referenceNo),
          ...datedCells(r),
        }),
      },
      {
        key: 'head-tests',
        title: 'Formula tests',
        noun: 'tests',
        needs: ['id'],
        load: async (ctx, p) => {
          const h = await this.heads.head(ctx, p.id!);
          return {
            rows: h.tests as unknown as Row[],
            title: `Pay head ${h.head.code} (${h.head.name}): formula tests`,
          };
        },
        filters: () => [
          { key: 'q', label: 'Test', kind: 'text' },
          {
            key: 'result',
            label: 'Last result',
            kind: 'select',
            options: opt([
              ['pass', 'Passed'],
              ['fail', 'Failed'],
              ['never', 'Not run'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.name], f.q ?? '') &&
          (!f.result || (f.result === 'never' ? !r.lastStatus : r.lastStatus === f.result)),
        columns: () => [
          { key: 'name', label: 'Test', width: 0.2 },
          { key: 'inputs', label: 'Inputs', width: 0.4 },
          { key: 'expected', label: 'Expected', kind: 'money', width: 0.12 },
          { key: 'last', label: 'Last result', kind: 'money', width: 0.12 },
          { key: 'status', label: 'Status', width: 0.1 },
        ],
        cells: (r) => ({
          name: s(r.name),
          inputs: Object.entries((r.inputs as Record<string, string>) ?? {})
            .map(([k, v]) => `${k} = ${v}`)
            .join('; '),
          expected: s(r.expected),
          last: s(r.lastResult),
          status:
            r.lastStatus === 'pass' ? 'Passed' : r.lastStatus === 'fail' ? 'Failed' : 'Not run',
        }),
      },
      // ---- the dated rate registry (one list per tab) -------------------------------------------------------------
      {
        key: 'config',
        title: 'Rates and statutory rules',
        noun: 'rows',
        needs: ['kind'],
        load: async (ctx, p) => {
          const kind = configKind(p);
          const d = await this.setup.listConfig(ctx, kind, { status: 'all' });
          return {
            rows: d.rows as unknown as Row[],
            title: `Rates and statutory rules: ${KIND_LABEL[kind]}`,
          };
        },
        filters: (rows, p) => {
          const kind = configKind(p);
          return [
            ...(kind === 'rates' ? [{ key: 'q', label: 'Code', kind: 'text' as const }] : []),
            ...(kind === 'pt' || kind === 'lwf'
              ? [
                  {
                    key: 'state',
                    label: 'State',
                    kind: 'select' as const,
                    options: distinct(rows, 'stateCode'),
                  },
                ]
              : []),
            ...(kind === 'ot' ? [{ key: 'q', label: 'Employee type', kind: 'text' as const }] : []),
            ...(kind === 'rates'
              ? [
                  {
                    key: 'source',
                    label: 'Source',
                    kind: 'select' as const,
                    options: opt([
                      ['govt', 'Government'],
                      ['school', 'School'],
                    ]),
                  },
                ]
              : []),
            { key: 'status', label: 'Status', kind: 'select', options: STATUS },
            { key: 'on', label: 'In force on', kind: 'date' },
          ];
        },
        match: (r, f) =>
          has1([r.rateCode, r.employeeType], f.q ?? '') &&
          (!f.state || r.stateCode === f.state) &&
          (!f.source || r.source === f.source) &&
          (!f.status || r.status === f.status) &&
          inForce(r, f.on ?? ''),
        columns: (p) => [
          ...CONFIG_COLS[configKind(p)].map((c, i) => ({
            key: `c${String(i)}`,
            label: c.label,
            width: 0.12,
          })),
          ...dated,
        ],
        cells: (r, p) => ({
          ...Object.fromEntries(
            CONFIG_COLS[configKind(p)].map((c, i) => [`c${String(i)}`, c.cell(r)]),
          ),
          ...datedCells(r),
        }),
      },
      // ---- the pay matrix: a row per cell, a column per level ----------------------------------------------------
      {
        key: 'matrix',
        title: 'Pay matrix',
        noun: 'cells',
        load: async (ctx, p) => {
          const m = await this.heads.matrix(ctx, p.code ? { code: p.code } : {});
          const levels = (m.levels ?? []) as Array<{
            level: string;
            cells: Array<{ cell: number; basic: string; effectiveFrom: string; used: number }>;
          }>;
          const cells = [...new Set(levels.flatMap((l) => l.cells.map((c) => c.cell)))].sort(
            (a, b) => a - b,
          );
          const rows = cells.map((cell) => {
            const row: Row = { cell };
            for (const l of levels) {
              const c = l.cells.find((x) => x.cell === cell);
              row[`L${l.level}`] = c ? c.basic : null;
              row[`U${l.level}`] = c ? c.used : 0;
            }
            return row;
          });
          return {
            rows,
            title: `Pay matrix ${m.code}`,
            extra: {
              code: m.code,
              active: m.active,
              codes: m.codes,
              levels: levels.map((l) => l.level),
              can: m.can,
            },
          };
        },
        filters: (rows) => {
          const levels = Object.keys(rows[0] ?? {})
            .filter((k) => k.startsWith('L'))
            .map((k) => k.slice(1));
          const o = levels.map((l) => ({ value: l, label: `Level ${l}` }));
          return [
            { key: 'levelFrom', label: 'Levels from', kind: 'select', options: o },
            { key: 'levelTo', label: 'to', kind: 'select', options: o },
            { key: 'cellFrom', label: 'Cells from', kind: 'text' },
            { key: 'cellTo', label: 'to', kind: 'text' },
          ];
        },
        match: (r, f) =>
          (!f.cellFrom || Number(r.cell) >= Number(f.cellFrom)) &&
          (!f.cellTo || Number(r.cell) <= Number(f.cellTo)),
        columns: (p, rows) => {
          const all = Object.keys(rows[0] ?? {})
            .filter((k) => k.startsWith('L'))
            .map((k) => k.slice(1));
          const i = p.levelFrom ? all.indexOf(p.levelFrom) : 0;
          const j = p.levelTo ? all.indexOf(p.levelTo) : all.length - 1;
          const shown = all.slice(Math.max(0, i), j < 0 ? all.length : j + 1);
          return [
            { key: 'cell', label: 'Cell', kind: 'number', width: 0.05 },
            ...shown.map((l) => ({
              key: `L${l}`,
              label: `Level ${l}`,
              kind: 'money' as const,
              width: 0.07,
            })),
          ];
        },
        cells: (r) => r as GridRow,
      },
      // ---- people -----------------------------------------------------------------------------------------------
      {
        key: 'profiles',
        title: 'Payroll profiles',
        noun: 'employees',
        load: async (ctx) => {
          const d = await this.people.profiles(ctx, { profile: 'all', page: 1, size: 100_000 });
          return {
            rows: d.rows as unknown as Row[],
            extra: { figures: (d as unknown as Row).figures },
          };
        },
        filters: (rows) => [
          { key: 'q', label: 'Code or name', kind: 'text' },
          {
            key: 'department',
            label: 'Department',
            kind: 'select',
            options: distinct(rows, 'department'),
          },
          {
            key: 'staffType',
            label: 'Staff type',
            kind: 'select',
            options: opt(Object.entries(STAFF)),
          },
          {
            key: 'profile',
            label: 'Profile',
            kind: 'select',
            options: opt([
              ['present', 'Has a profile'],
              ['missing', 'No profile'],
            ]),
          },
          {
            key: 'status',
            label: 'Pay status',
            kind: 'select',
            options: opt([
              ['ACTIVE', 'Active'],
              ['HOLD', 'On hold'],
              ['LEFT', 'Left'],
            ]),
          },
          {
            key: 'regime',
            label: 'Tax regime',
            kind: 'select',
            options: opt([
              ['NEW', 'New'],
              ['OLD', 'Old'],
            ]),
          },
          {
            key: 'missing',
            label: 'Missing',
            kind: 'select',
            options: opt([
              ['pan', 'No PAN'],
              ['bank', 'No bank account'],
              ['uan', 'No UAN'],
              ['structure', 'No structure'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.code, r.name], f.q ?? '') &&
          (!f.department || r.department === f.department) &&
          (!f.staffType || r.staffType === f.staffType) &&
          (!f.profile || (f.profile === 'present') === !!r.hasProfile) &&
          (!f.status || r.payrollStatus === f.status) &&
          (!f.regime || r.taxRegime === f.regime) &&
          (!f.missing ||
            (f.missing === 'pan'
              ? !r.panMasked
              : f.missing === 'bank'
                ? !r.bankMasked
                : f.missing === 'uan'
                  ? !r.uan
                  : !r.structured)),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.07 },
          { key: 'name', label: 'Name', width: 0.14 },
          { key: 'department', label: 'Department', width: 0.1 },
          { key: 'staffType', label: 'Staff type', width: 0.08 },
          { key: 'level', label: 'Level · cell', width: 0.07 },
          { key: 'regime', label: 'Regime', width: 0.05 },
          { key: 'pan', label: 'PAN', width: 0.08 },
          { key: 'bank', label: 'Bank account', width: 0.08 },
          { key: 'uan', label: 'UAN', width: 0.08 },
          { key: 'mode', label: 'Paid by', width: 0.06 },
          { key: 'structure', label: 'Structure', width: 0.06 },
          { key: 'status', label: 'Pay status', width: 0.06 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          department: s(r.department),
          staffType: STAFF[s(r.staffType)] ?? s(r.staffType),
          level: r.payLevel ? `${s(r.payLevel)} · ${s(r.payCell)}` : '',
          regime: s(r.taxRegime),
          // masked as on the screen
          pan: s(r.panMasked),
          bank: s(r.bankMasked),
          uan: s(r.uan),
          mode: s(r.payMode),
          structure: r.structured ? 'In force' : 'None',
          status: r.hasProfile ? s(r.payrollStatus) : 'No profile',
        }),
      },
      {
        key: 'structures',
        title: 'Salary structures',
        noun: 'employees',
        load: async (ctx) => ({
          rows: (await this.people.profiles(ctx, { profile: 'all', page: 1, size: 100_000 }))
            .rows as unknown as Row[],
        }),
        filters: (rows) => [
          { key: 'q', label: 'Code or name', kind: 'text' },
          {
            key: 'department',
            label: 'Department',
            kind: 'select',
            options: distinct(rows, 'department'),
          },
          {
            key: 'staffType',
            label: 'Staff type',
            kind: 'select',
            options: opt(Object.entries(STAFF)),
          },
          {
            key: 'structure',
            label: 'Structure',
            kind: 'select',
            options: opt([
              ['yes', 'In force'],
              ['no', 'None'],
            ]),
          },
          { key: 'level', label: 'Pay level', kind: 'select', options: distinct(rows, 'payLevel') },
        ],
        match: (r, f) =>
          has1([r.code, r.name], f.q ?? '') &&
          (!f.department || r.department === f.department) &&
          (!f.staffType || r.staffType === f.staffType) &&
          (!f.structure || (f.structure === 'yes') === !!r.structured) &&
          (!f.level || s(r.payLevel) === f.level),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.1 },
          { key: 'name', label: 'Name', width: 0.22 },
          { key: 'department', label: 'Department', width: 0.16 },
          { key: 'staffType', label: 'Staff type', width: 0.12 },
          { key: 'level', label: 'Level · cell', width: 0.1 },
          { key: 'structure', label: 'Structure', width: 0.1 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          department: s(r.department),
          staffType: STAFF[s(r.staffType)] ?? s(r.staffType),
          level: r.payLevel ? `${s(r.payLevel)} · ${s(r.payCell)}` : '',
          structure: r.structured ? 'In force' : 'None',
        }),
      },
      {
        key: 'templates',
        title: 'Structure templates',
        noun: 'templates',
        load: async (ctx) => ({
          rows: (await this.people.templates(ctx)).templates as unknown as Row[],
        }),
        filters: () => [
          { key: 'q', label: 'Name', kind: 'text' },
          { key: 'staffType', label: 'For', kind: 'select', options: opt(Object.entries(STAFF)) },
        ],
        match: (r, f) =>
          has1([r.name, r.description], f.q ?? '') &&
          (!f.staffType || ((r.staffTypes as string[] | null) ?? []).includes(f.staffType)),
        columns: () => [
          { key: 'name', label: 'Template', width: 0.18 },
          { key: 'description', label: 'Description', width: 0.22 },
          { key: 'for', label: 'For', width: 0.14 },
          { key: 'lines', label: 'Amounts (₹ a month)', width: 0.4 },
        ],
        cells: (r) => ({
          name: s(r.name),
          description: s(r.description),
          for:
            ((r.staffTypes as string[] | null) ?? []).map((t) => STAFF[t] ?? t).join(', ') ||
            'Everyone',
          lines: Object.entries((r.lines as Record<string, string>) ?? {})
            .map(([k, v]) => `${k} ${inr(v)}`)
            .join('; '),
        }),
      },
      {
        key: 'structure-drafts',
        title: 'Salary structure drafts',
        noun: 'employees',
        load: async (ctx) => ({
          rows: (await this.people.drafts(ctx, {})).rows as unknown as Row[],
        }),
        filters: (rows) => [
          { key: 'q', label: 'Code or name', kind: 'text' },
          {
            key: 'department',
            label: 'Department',
            kind: 'select',
            options: distinct(rows, 'department'),
          },
          {
            key: 'mine',
            label: 'Made by',
            kind: 'select',
            options: opt([
              ['mine', 'Me'],
              ['others', 'Others'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.code, r.name], f.q ?? '') &&
          (!f.department || r.department === f.department) &&
          (!f.mine || (f.mine === 'mine') === !!r.mine),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.1 },
          { key: 'name', label: 'Employee', width: 0.22 },
          { key: 'department', label: 'Department', width: 0.16 },
          { key: 'lines', label: 'Amounts', kind: 'number', width: 0.08 },
          { key: 'from', label: 'From', width: 0.1 },
          { key: 'by', label: 'Made by', width: 0.16 },
          { key: 'on', label: 'Made on', width: 0.1 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          department: s(r.department),
          lines: Number(r.lines),
          from: dmy(r.effectiveFrom),
          by: s(r.madeBy),
          on: dmy(r.madeAt),
        }),
      },
      {
        key: 'setup-drafts',
        title: 'Rate, rule and pay-head drafts',
        noun: 'drafts',
        load: async (ctx) => {
          const [hs, ...cs] = await Promise.all([
            this.heads.heads(ctx),
            ...KINDS.map((k) => this.setup.listConfig(ctx, k, { status: 'draft' })),
          ]);
          const rows: Row[] = [];
          KINDS.forEach((k, i) => {
            for (const r of cs[i]!.rows as unknown as Row[])
              rows.push({
                kind: k,
                kindLabel: KIND_LABEL[k],
                id: r.id,
                what: configWhat(k, r),
                from: r.effectiveFrom,
                by: r.createdByName,
                mine: r.mine,
                why: r.changeReason,
                href: `/payroll/setup/rates?tab=${k}&status=draft`,
              });
          });
          for (const h of hs.heads as unknown as Row[])
            if (Number(h.drafts) > 0)
              rows.push({
                kind: 'head',
                kindLabel: 'Pay-head version',
                id: h.id,
                what: `${s(h.code)} ${s(h.name)}: ${s(h.drafts)} draft version(s)`,
                from: null,
                by: null,
                mine: false,
                why: null,
                href: `/payroll/setup/heads/${s(h.id)}`,
                drafts: Number(h.drafts),
              });
          return {
            rows,
            extra: {
              rates: rows.filter((r) => r.kind !== 'head').length,
              versions: rows.reduce((n, r) => n + Number(r.drafts ?? 0), 0),
            },
          };
        },
        filters: () => [
          {
            key: 'kind',
            label: 'Kind',
            kind: 'select',
            options: opt([
              ...KINDS.map((k) => [k, KIND_LABEL[k]] as [string, string]),
              ['head', 'Pay-head versions'],
            ]),
          },
          {
            key: 'mine',
            label: 'Made by',
            kind: 'select',
            options: opt([
              ['mine', 'Me'],
              ['others', 'Others'],
            ]),
          },
          { key: 'q', label: 'What', kind: 'text' },
        ],
        match: (r, f) =>
          (!f.kind || r.kind === f.kind) &&
          (!f.mine || (f.mine === 'mine') === !!r.mine) &&
          has1([r.what, r.why], f.q ?? ''),
        columns: () => [
          { key: 'kind', label: 'Kind', width: 0.12 },
          { key: 'what', label: 'What', width: 0.3 },
          { key: 'from', label: 'From', width: 0.1 },
          { key: 'by', label: 'Made by', width: 0.16 },
          { key: 'why', label: 'Why', width: 0.3 },
        ],
        cells: (r) => ({
          kind: s(r.kindLabel),
          what: s(r.what),
          from: dmy(r.from),
          by: s(r.by),
          why: s(r.why),
        }),
      },
      {
        key: 'profile-nominees',
        title: 'Nominees',
        noun: 'nominees',
        needs: ['employeeId'],
        load: async (ctx, p) => {
          const d = await this.people.profile(ctx, p.employeeId!);
          const e = d.employee as unknown as Row;
          return {
            rows: d.nominees as unknown as Row[],
            title: `Nominees of ${s(e.name)} (${s(e.code)})`,
          };
        },
        filters: (rows) => [
          { key: 'purpose', label: 'For', kind: 'select', options: distinct(rows, 'purpose') },
          { key: 'q', label: 'Name', kind: 'text' },
        ],
        match: (r, f) => (!f.purpose || r.purpose === f.purpose) && has1([r.name], f.q ?? ''),
        columns: () => [
          { key: 'name', label: 'Name', width: 0.16 },
          { key: 'relation', label: 'Relation', width: 0.1 },
          { key: 'dob', label: 'Born', width: 0.08 },
          { key: 'share', label: 'Share %', kind: 'number', width: 0.06 },
          { key: 'purpose', label: 'For', width: 0.1 },
          { key: 'guardian', label: 'Guardian', width: 0.14 },
          { key: 'address', label: 'Address', width: 0.26 },
        ],
        cells: (r) => ({
          name: s(r.name),
          relation: s(r.relation),
          dob: dmy(r.dob),
          share: s(r.sharePercent),
          purpose: s(r.purpose),
          guardian: s(r.guardianName),
          address: s(r.address),
        }),
      },
      {
        key: 'profile-changes',
        title: 'Profile history',
        noun: 'changes',
        needs: ['employeeId'],
        load: async (ctx, p) => {
          const d = await this.people.profile(ctx, p.employeeId!);
          const e = d.employee as unknown as Row;
          return {
            rows: d.changes as unknown as Row[],
            title: `Profile history of ${s(e.name)} (${s(e.code)})`,
          };
        },
        filters: (rows) => [
          { key: 'field', label: 'Field', kind: 'select', options: distinct(rows, 'field') },
          { key: 'from', label: 'Changed from', kind: 'date' },
          { key: 'to', label: 'to', kind: 'date' },
        ],
        match: (r, f) =>
          (!f.field || r.field === f.field) &&
          (!f.from || s(r.changedAt).slice(0, 10) >= f.from) &&
          (!f.to || s(r.changedAt).slice(0, 10) <= f.to),
        columns: () => [
          { key: 'field', label: 'Field', width: 0.16 },
          { key: 'was', label: 'Was', width: 0.18 },
          { key: 'now', label: 'Now', width: 0.18 },
          { key: 'from', label: 'From', width: 0.1 },
          { key: 'on', label: 'Changed on', width: 0.1 },
          { key: 'by', label: 'By', width: 0.16 },
        ],
        cells: (r) => ({
          field: s(r.field),
          was: s(r.oldValue),
          now: s(r.newValue),
          from: dmy(r.effectiveFrom),
          on: dmy(r.changedAt),
          by: s(r.changedBy),
        }),
      },
      {
        key: 'structure-heads',
        title: 'Structure',
        noun: 'heads',
        needs: ['employeeId'],
        load: async (ctx, p) => {
          const d = await this.people.structure(ctx, p.employeeId!, p.asOf || undefined);
          const e = d.employee as unknown as Row;
          return {
            rows: d.heads as unknown as Row[],
            title: `Structure of ${s(e.name)} (${s(e.code)}) as of ${dmy(d.asOf)}`,
          };
        },
        filters: () => [
          {
            key: 'type',
            label: 'Type',
            kind: 'select',
            options: opt([
              ['EARNING', 'Earnings'],
              ['DEDUCTION', 'Deductions'],
            ]),
          },
          {
            key: 'state',
            label: 'Shows',
            kind: 'select',
            options: opt([
              ['live', 'An amount in force'],
              ['draft', 'A draft'],
              ['none', 'Nothing'],
            ]),
          },
          { key: 'q', label: 'Code or name', kind: 'text' },
        ],
        match: (r, f) =>
          (!f.type || r.headType === f.type) &&
          (!f.state ||
            (f.state === 'live'
              ? !!r.liveId
              : f.state === 'draft'
                ? !!r.draftId
                : !r.liveId && !r.draftId)) &&
          has1([r.code, r.name], f.q ?? ''),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.09 },
          { key: 'name', label: 'Name', width: 0.16 },
          { key: 'type', label: 'Type', width: 0.08 },
          { key: 'calc', label: 'Worked out', width: 0.2 },
          { key: 'live', label: 'In force (₹)', kind: 'money', width: 0.1 },
          { key: 'liveFrom', label: 'From', width: 0.08 },
          { key: 'draft', label: 'Draft (₹)', kind: 'money', width: 0.1 },
          { key: 'draftFrom', label: 'Draft from', width: 0.08 },
          { key: 'draftBy', label: 'Draft by', width: 0.11 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          type: r.headType === 'EARNING' ? 'Earning' : 'Deduction',
          calc: `${CALC[s(r.calcType)] ?? ''}${r.formula ? ` ${s(r.formula)}` : ''}`,
          live: r.liveAmount === null ? null : s(r.liveAmount),
          liveFrom: dmy(r.liveFrom),
          draft: r.draftAmount === null ? null : s(r.draftAmount),
          draftFrom: dmy(r.draftFrom),
          draftBy: s(r.draftBy),
        }),
      },
      {
        key: 'structure-timeline',
        title: 'Structure timeline',
        noun: 'amounts',
        needs: ['employeeId'],
        load: async (ctx, p) => {
          const d = await this.people.structure(ctx, p.employeeId!);
          const e = d.employee as unknown as Row;
          return {
            rows: d.timeline as unknown as Row[],
            title: `Structure timeline of ${s(e.name)} (${s(e.code)})`,
          };
        },
        filters: (rows) => [
          { key: 'head', label: 'Head', kind: 'select', options: distinct(rows, 'code') },
          { key: 'status', label: 'Status', kind: 'select', options: STATUS },
          { key: 'on', label: 'In force on', kind: 'date' },
        ],
        match: (r, f) =>
          (!f.head || r.code === f.head) &&
          (!f.status || r.status === f.status) &&
          inForce(r, f.on ?? ''),
        columns: () => [
          { key: 'code', label: 'Head', width: 0.1 },
          { key: 'name', label: 'Name', width: 0.16 },
          { key: 'amount', label: 'Amount (₹)', kind: 'money', width: 0.1 },
          { key: 'from', label: 'From', width: 0.08 },
          { key: 'to', label: 'To', width: 0.08 },
          { key: 'status', label: 'Status', width: 0.07 },
          { key: 'why', label: 'Why', width: 0.2 },
          { key: 'made', label: 'Made · approved by', width: 0.16 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          amount: s(r.amount),
          from: dmy(r.effectiveFrom),
          to: r.effectiveTo ? dmy(r.effectiveTo) : 'Open',
          status: s(r.status),
          why: s(r.changeReason),
          made: [r.madeBy, r.approvedBy].filter(Boolean).join(' · '),
        }),
      },
      // ---- income tax -------------------------------------------------------------------------------------------
      {
        key: 'tax-slabs',
        title: 'Income-tax slabs',
        noun: 'slabs',
        load: async (ctx, p) => {
          const d = await this.setup.tax(ctx, p.fy ? { fy: p.fy } : {});
          return {
            rows: d.slabs as unknown as Row[],
            title: `Income-tax slabs ${d.fy}`,
            extra: { fy: d.fy, config: d.config, surcharges: d.surcharges },
          };
        },
        filters: () => [
          {
            key: 'regime',
            label: 'Regime',
            kind: 'select',
            options: opt([
              ['NEW', 'New'],
              ['OLD', 'Old'],
            ]),
          },
        ],
        match: (r, f) => !f.regime || r.regime === f.regime,
        columns: () => [
          { key: 'regime', label: 'Regime', width: 0.12 },
          { key: 'from', label: 'Taxable income from (₹)', kind: 'money', width: 0.2 },
          { key: 'to', label: 'up to (₹)', kind: 'money', width: 0.2 },
          { key: 'rate', label: 'Rate', width: 0.12 },
        ],
        cells: (r) => ({
          regime: s(r.regime),
          from: s(r.slabFrom),
          to: r.slabTo === null ? null : s(r.slabTo),
          rate: pct(r.rate),
        }),
      },
      {
        key: 'tax-labels',
        title: 'Deductions and exemptions',
        noun: 'lines',
        load: async (ctx, p) => {
          const d = await this.setup.tax(ctx, p.fy ? { fy: p.fy } : {});
          return {
            rows: d.labels as unknown as Row[],
            title: `Deductions and exemptions ${d.fy}`,
          };
        },
        filters: () => [
          { key: 'q', label: 'Code or label', kind: 'text' },
          {
            key: 'regime',
            label: 'Regime',
            kind: 'select',
            options: opt([
              ['NEW', 'New'],
              ['OLD', 'Old'],
              ['BOTH', 'Both'],
            ]),
          },
          {
            key: 'declarable',
            label: 'Staff declare it',
            kind: 'select',
            options: opt([
              ['yes', 'Yes'],
              ['no', 'No'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.lineCode, r.label], f.q ?? '') &&
          (!f.regime || s(r.appliesTo).toUpperCase() === f.regime) &&
          (!f.declarable || (f.declarable === 'yes') === !!r.declarable),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.12 },
          { key: 'label', label: 'Label', width: 0.4 },
          { key: 'regime', label: 'Regime', width: 0.1 },
          { key: 'cap', label: 'Cap (₹)', kind: 'money', width: 0.12 },
          { key: 'declarable', label: 'Staff declare it', width: 0.12 },
        ],
        cells: (r) => ({
          code: s(r.lineCode),
          label: s(r.label),
          regime: s(r.appliesTo),
          cap: r.capAmount === null ? null : s(r.capAmount),
          declarable: yes(r.declarable),
        }),
      },
      // ---- bank accounts ----------------------------------------------------------------------------------------
      {
        key: 'bank-accounts',
        title: 'Bank accounts',
        noun: 'accounts',
        rights: [RUN.approve, PAYROLL.admin],
        load: async (ctx) => ({
          rows: (await this.bank.accounts(ctx)).rows as unknown as Row[],
        }),
        filters: (rows) => [
          { key: 'q', label: 'Bank or code', kind: 'text' },
          { key: 'format', label: 'File', kind: 'select', options: distinct(rows, 'fileFormat') },
          {
            key: 'active',
            label: 'Status',
            kind: 'select',
            options: opt([
              ['yes', 'In use'],
              ['no', 'Not in use'],
            ]),
          },
        ],
        match: (r, f) =>
          has1([r.bankCode, r.bankName, r.branch], f.q ?? '') &&
          (!f.format || r.fileFormat === f.format) &&
          (!f.active || (f.active === 'yes') === !!r.active),
        columns: () => [
          { key: 'code', label: 'Code', width: 0.1 },
          { key: 'bank', label: 'Bank', width: 0.22 },
          { key: 'branch', label: 'Branch', width: 0.18 },
          { key: 'account', label: 'Account', width: 0.16 },
          { key: 'file', label: 'File', width: 0.14 },
          { key: 'active', label: 'Status', width: 0.1 },
        ],
        cells: (r) => ({
          code: s(r.bankCode),
          bank: s(r.bankName),
          branch: s(r.branch),
          account: s(r.accountNo),
          file: s(r.fileFormat),
          active: r.active ? 'In use' : 'Not in use',
        }),
      },
      // ---- go-live ----------------------------------------------------------------------------------------------
      {
        key: 'golive-staged',
        title: 'Old payroll: rows read',
        noun: 'tables',
        rights: [RUN.approve, PAYROLL.admin, 'payroll.audit.view', 'payroll.golive.countersign'],
        load: async (ctx) => ({
          rows: ((await this.golive.overview(ctx)) as unknown as { staged: Row[] }).staged,
        }),
        filters: () => [{ key: 'q', label: 'Table', kind: 'text' }],
        match: (r, f) => has1([r.tbl], f.q ?? ''),
        columns: () => [
          { key: 'tbl', label: 'Table of the old payroll', width: 0.5 },
          { key: 'n', label: 'Rows read', kind: 'number', width: 0.2 },
        ],
        cells: (r) => ({ tbl: s(r.tbl), n: Number(r.n) }),
      },
      {
        key: 'golive-batches',
        title: 'Comparisons with the old payroll',
        noun: 'comparisons',
        rights: [RUN.approve, PAYROLL.admin, 'payroll.audit.view', 'payroll.golive.countersign'],
        load: async (ctx) => ({
          rows: ((await this.golive.overview(ctx)) as unknown as { batches: Row[] }).batches,
        }),
        filters: () => [
          {
            key: 'kind',
            label: 'Kind',
            kind: 'select',
            options: opt([
              ['REPLAY', 'Old months replayed'],
              ['PARALLEL', 'Parallel months'],
            ]),
          },
          {
            key: 'open',
            label: 'Differences',
            kind: 'select',
            options: opt([
              ['yes', 'Some open'],
              ['no', 'None open'],
            ]),
          },
        ],
        match: (r, f) =>
          (!f.kind || r.kind === f.kind) && (!f.open || (f.open === 'yes') === Number(r.open) > 0),
        columns: () => [
          { key: 'id', label: 'No.', kind: 'number', width: 0.06 },
          { key: 'kind', label: 'Kind', width: 0.16 },
          { key: 'months', label: 'Months', width: 0.3 },
          { key: 'open', label: 'Open', kind: 'number', width: 0.08 },
          { key: 'by', label: 'By', width: 0.16 },
          { key: 'on', label: 'On', width: 0.1 },
        ],
        cells: (r) => ({
          id: Number(r.id),
          kind: r.kind === 'REPLAY' ? 'Old months replayed' : 'Parallel months',
          months: ((r.months as string[]) ?? []).join(', '),
          open: Number(r.open),
          by: s(r.by),
          on: dmy(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at),
        }),
      },
      {
        key: 'parity',
        title: 'Comparison with the old payroll',
        noun: 'differences',
        needs: ['batchId'],
        rights: [RUN.approve, PAYROLL.admin, 'payroll.audit.view', 'payroll.golive.countersign'],
        // the status, month and head go to the database: a replay of two years holds many rows
        load: async (ctx, p) => {
          const d = (await this.golive.results(ctx, p.batchId!, {
            ...parityQuery(p),
            page: 1,
            size: 1_000_000,
          })) as unknown as Row & { rows: Row[] };
          const { rows, ...extra } = d;
          return { rows, extra, title: `Comparison no. ${p.batchId!} with the old payroll` };
        },
        pageLoad: async (ctx, p, page, size) => {
          const d = (await this.golive.results(ctx, p.batchId!, {
            ...parityQuery(p),
            page,
            size,
          })) as unknown as Row & {
            rows: Row[];
            total: number;
            byMonth: Array<{ open: number; explained: number; match: number }>;
          };
          const { rows, total, ...extra } = d;
          const all = d.byMonth.reduce((n, m) => n + m.open + m.explained + m.match, 0);
          return { rows, total, all, extra };
        },
        filters: (_rows, _p, extra) => [
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            options: opt([
              ['OPEN', 'Open'],
              ['EXPLAINED', 'Explained'],
              ['MATCH', 'The same'],
            ]),
          },
          {
            key: 'month',
            label: 'Month',
            kind: 'select',
            options: (
              ((extra?.batch as Row | undefined)?.months as string[] | undefined) ?? []
            ).map((m) => ({ value: m, label: m })),
          },
          {
            key: 'component',
            label: 'Head or total',
            kind: 'select',
            options: ((extra?.scoreboard as Row[] | undefined) ?? []).map((x) => ({
              value: s(x.component),
              label: s(x.component),
            })),
          },
        ],
        // the database applied them already
        match: () => true,
        columns: () => [
          { key: 'code', label: 'Code', width: 0.07 },
          { key: 'name', label: 'Employee', width: 0.14 },
          { key: 'month', label: 'Month', width: 0.07 },
          { key: 'component', label: 'Head', width: 0.08 },
          { key: 'legacy', label: 'Old payroll (₹)', kind: 'money', width: 0.09 },
          { key: 'ours', label: 'EduPro (₹)', kind: 'money', width: 0.09 },
          { key: 'diff', label: 'Difference (₹)', kind: 'money', width: 0.09 },
          { key: 'status', label: 'Status', width: 0.07 },
          { key: 'why', label: 'Explanation or note', width: 0.25 },
        ],
        cells: (r) => ({
          code: s(r.code),
          name: s(r.name),
          month: s(r.month),
          component: s(r.component),
          legacy: r.legacy === null ? null : s(r.legacy),
          ours: r.ours === null ? null : s(r.ours),
          diff: s(r.diff),
          status: r.status === 'MATCH' ? 'The same' : r.status === 'OPEN' ? 'Open' : 'Explained',
          why: [r.explanation_code, r.explanation, r.note].filter(Boolean).join(' · '),
        }),
      },
      // ---- the settings, one line each --------------------------------------------------------------------------
      {
        key: 'settings',
        title: 'Payroll settings',
        noun: 'settings',
        load: async (ctx) => {
          const d = (await this.setup.settings(ctx)) as unknown as {
            settings: Row;
            confidential: Row[];
          };
          const st = d.settings;
          const rows: Row[] = [
            ['State', st.stateCode],
            ['PF establishment code', st.pfEstablishmentCode],
            ['TAN', st.tan],
            ['Profession tax registration', st.ptrcNo],
            ['ESI code', st.esiCode],
            ['Labour welfare fund', yes(st.lwfEnabled)],
            ['EPS stops at age', st.epsStopAge],
            ['PF ceiling pro-rated', yes(st.pfCeilingProrate)],
            ['Pay matrix', st.matrixCode],
            ['Pay cycle starts on day', st.payCycleFromDay ?? 'The 1st (calendar month)'],
            ['Overtime hours a month at most', st.otHoursLimit],
            ['Payslip password', st.payslipPassword ? 'Set' : 'None'],
            ['Bank file', st.bankFileFormat],
            [
              'Tax regime can change until month',
              MONTHS[Number(st.regimeCutoffMonth) - 1] ?? s(st.regimeCutoffMonth),
            ],
            [
              'Confidential staff',
              (d.confidential ?? []).map((c) => `${s(c.name)} (${s(c.code)})`).join(', ') || 'None',
            ],
            [
              'Formula attributes',
              ((st.formulaAttributes as Row[] | null) ?? [])
                .map((a) => `${s(a.code)} = ${s(a.field)} is ${s(a.value)}`)
                .join('; ') || 'None',
            ],
          ].map(([setting, value]) => ({ setting, value: s(value) }));
          return { rows };
        },
        filters: () => [{ key: 'q', label: 'Setting', kind: 'text' }],
        match: (r, f) => has1([r.setting, r.value], f.q ?? ''),
        columns: () => [
          { key: 'setting', label: 'Setting', width: 0.35 },
          { key: 'value', label: 'Value', width: 0.65 },
        ],
        cells: (r) => ({ setting: s(r.setting), value: s(r.value) }),
      },
    ];
    this.defs = Object.fromEntries(list.map((d) => [d.key, d]));
  }

  private def(ctx: RequestContext, key: string, p: Params) {
    const d = this.defs[key];
    if (!d) bad('Not a list of the payroll set-up', 404);
    const ok = d!.rights ? d!.rights.some((r) => has(ctx, r)) : has(ctx, PAYROLL.view);
    if (!ok) bad('You cannot open this list', 403);
    for (const n of d!.needs ?? []) if (!p[n]) bad(`Say which ${n}`, 400);
    return d!;
  }

  /** the rows the filters leave, and the filters with their choices */
  private async filtered(ctx: RequestContext, d: ListDef, p: Params) {
    const loaded = await d.load(ctx, p);
    const filters = d.filters(loaded.rows, p, loaded.extra);
    const applied = Object.fromEntries(
      filters.map((f) => [f.key, p[f.key] ?? '']).filter(([, v]) => v !== ''),
    ) as Params;
    const rows = loaded.rows.filter((r) => d.match(r, applied));
    return { loaded, filters, applied, rows };
  }

  /** a page of the list, filtered, for the screen */
  async page(ctx: RequestContext, key: string, raw: Record<string, unknown>) {
    const p = clean(raw);
    const d = this.def(ctx, key, p);
    const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 50;
    if (d.pageLoad) {
      const page = Math.max(1, Number(p.page) || 1);
      const r = await d.pageLoad(ctx, p, page, size);
      const filters = d.filters(r.rows, p, r.extra);
      return {
        key,
        title: r.title ?? d.title,
        noun: d.noun,
        filters,
        applied: Object.fromEntries(
          filters.map((f) => [f.key, p[f.key] ?? '']).filter(([, v]) => v !== ''),
        ),
        rows: r.rows,
        total: r.total,
        all: r.all,
        page,
        size,
        ...(r.extra ? { extra: r.extra } : {}),
      };
    }
    const { loaded, filters, applied, rows } = await this.filtered(ctx, d, p);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(Math.max(1, Number(p.page) || 1), pages);
    return {
      key,
      title: loaded.title ?? d.title,
      noun: d.noun,
      filters,
      applied,
      rows: rows.slice((page - 1) * size, page * size),
      total: rows.length,
      all: loaded.rows.length,
      page,
      size,
      columns: d.columns(p, loaded.rows).map((c) => c.key),
      ...(loaded.extra ? { extra: loaded.extra } : {}),
    };
  }

  /** the grid a file is drawn from: every filtered row, the filters as a line under the title */
  private async grid(ctx: RequestContext, d: ListDef, p: Params): Promise<Grid> {
    const { loaded, filters, applied, rows } = await this.filtered(ctx, d, p);
    const words = filters
      .filter((f) => applied[f.key])
      .map((f) => {
        const v = applied[f.key]!;
        const shown =
          f.kind === 'select'
            ? (f.options?.find((o) => o.value === v)?.label ?? v)
            : f.kind === 'date'
              ? dmy(v)
              : `“${v}”`;
        return `${f.label}: ${shown}`;
      });
    return {
      key: d.key,
      title: loaded.title ?? d.title,
      period: `${String(rows.length)} of ${String(loaded.rows.length)} ${d.noun}`,
      subtitle: [words.length ? `Filters: ${words.join(' · ')}` : 'Filters: none (every row)'],
      columns: d.columns(p, loaded.rows),
      rows: rows.map((r) => d.cells(r, p)),
      subtotals: [],
      total: null,
      provisional: null,
    };
  }

  /** every filtered row as Excel or PDF, recorded in the payroll audit trail */
  async file(ctx: RequestContext, key: string, raw: Record<string, unknown>) {
    const p = clean(raw);
    const format = p.format === 'pdf' ? 'pdf' : 'xlsx';
    const d = this.def(ctx, key, p);
    const g = await this.grid(ctx, d, p);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await this.reports.head(c);
      await this.audit.stage(ctx, c, {
        action: 'payroll.setup.download',
        entityType: 'payroll_setup_lists',
        entityId: key,
        after: { params: p, format, rows: g.rows.length },
      });
      const name = g.title.replace(/\W+/g, '_').replace(/_+/g, '_').replace(/_$/, '');
      if (format === 'pdf')
        return {
          filename: `${name}.pdf`,
          contentType: 'application/pdf',
          base64: (
            await gridPdf(g, head, await preparedChecked(c, (k) => this.storage.read(k)))
          ).toString('base64'),
        };
      const wb = new ExcelJS.Workbook();
      gridSheet(wb, g, head.school, 'List');
      return {
        filename: `${name}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    });
  }

  /**
   * The Set-up book: the settings, pay heads, each rate tab (the rows in force today), the pay matrix, the templates,
   * this year's tax slabs and lines, and the bank accounts (for those who see them) — a sheet each, or one PDF.
   */
  async book(ctx: RequestContext, raw: Record<string, unknown>) {
    if (!has(ctx, PAYROLL.view)) bad('You cannot open the payroll set-up', 403);
    const format = clean(raw).format === 'pdf' ? 'pdf' : 'xlsx';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const parts: Array<{ key: string; p: Params; sheet: string }> = [
      { key: 'settings', p: {}, sheet: 'Settings' },
      { key: 'heads', p: {}, sheet: 'Pay heads' },
      ...KINDS.map((k) => ({ key: 'config', p: { kind: k, on: today }, sheet: KIND_LABEL[k] })),
      { key: 'matrix', p: {}, sheet: 'Pay matrix' },
      { key: 'templates', p: {}, sheet: 'Templates' },
      { key: 'tax-slabs', p: {}, sheet: 'Tax slabs' },
      { key: 'tax-labels', p: {}, sheet: 'Tax lines' },
      ...(has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)
        ? [{ key: 'bank-accounts', p: {}, sheet: 'Bank accounts' }]
        : []),
    ];
    const grids: Array<{ g: Grid; sheet: string }> = [];
    for (const x of parts) {
      const g = await this.grid(ctx, this.defs[x.key]!, x.p);
      grids.push({ g, sheet: x.sheet });
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await this.reports.head(c);
      await this.audit.stage(ctx, c, {
        action: 'payroll.setup.download',
        entityType: 'payroll_setup_lists',
        entityId: 'book',
        after: { format, sheets: grids.map((x) => x.sheet) },
      });
      const name = `Payroll_set-up_book_${today}`;
      if (format === 'xlsx') {
        const wb = new ExcelJS.Workbook();
        for (const x of grids) gridSheet(wb, x.g, head.school, x.sheet.slice(0, 31));
        return {
          filename: `${name}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        };
      }
      // one PDF: each list on its own pages, the Prepared / Checked boxes on the last
      const signs = await preparedChecked(c, (k) => this.storage.read(k));
      const out = await PDFDocument.create();
      for (const [i, x] of grids.entries()) {
        const one = await PDFDocument.load(
          // the logo once, on the first section: each section carrying it made the book many times larger
          await gridPdf(
            x.g,
            i === 0 ? head : { ...head, logo: null },
            i === grids.length - 1 ? signs : [],
          ),
        );
        for (const pg of await out.copyPages(one, one.getPageIndices())) out.addPage(pg);
      }
      return {
        filename: `${name}.pdf`,
        contentType: 'application/pdf',
        base64: Buffer.from(await out.save()).toString('base64'),
      };
    });
  }
}

/** the query as plain strings: names of letters only, values cut to 100 characters */
function clean(raw: Record<string, unknown>): Params {
  const p: Params = {};
  for (const [k, v] of Object.entries(raw ?? {}))
    if (/^[A-Za-z]{1,20}$/.test(k) && typeof v === 'string' && v.trim() !== '')
      p[k] = v.trim().slice(0, 100);
  if (p.on && !/^\d{4}-\d{2}-\d{2}$/.test(p.on)) delete p.on;
  for (const k of ['from', 'to'])
    if (p[k] && /^\d/.test(p[k]!) && !/^\d{4}-\d{2}-\d{2}$/.test(p[k]!)) delete p[k];
  if (p.id && !/^\d{1,18}$/.test(p.id)) bad('Not an id', 400);
  if (p.employeeId && !/^\d{1,18}$/.test(p.employeeId)) bad('Not an id', 400);
  if (p.batchId && !/^\d{1,18}$/.test(p.batchId)) bad('Not an id', 400);
  if (p.fy && !/^\d{4}-\d{2}$/.test(p.fy)) delete p.fy;
  if (p.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(p.asOf)) delete p.asOf;
  return p;
}
