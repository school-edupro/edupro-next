import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Payroll rights (0365). */
export const PAYROLL = {
  view: 'payroll.setup.view',
  manage: 'payroll.setup.manage',
  approve: 'payroll.setup.approve',
  admin: 'payroll.settings.manage',
  reveal: 'payroll.profile.reveal',
} as const;

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');
/** money or a rate as a decimal string, never a float */
const Dec = (dp = 2) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,12}(\\.\\d{1,${String(dp)}})?$`),
      `a number with up to ${String(dp)} decimals`,
    );
const Rate = Dec(6);
const State = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'a two-letter state code');
const Code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'capital letters, digits and _ (DA_RATE)');

/** what every dated row carries */
const Dated = {
  effectiveFrom: Day,
  referenceNo: z.string().trim().max(60).nullable().optional(),
  changeReason: z.string().trim().max(200).nullable().optional(),
};

// ---- settings ------------------------------------------------------------------------------------------
export const PayrollSettingsSchema = z.object({
  stateCode: State.nullable(),
  pfEstablishmentCode: z.string().trim().max(40).nullable(),
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, 'a TAN (ABCD12345E)')
    .nullable(),
  ptrcNo: z.string().trim().max(40).nullable(),
  esiCode: z.string().trim().max(40).nullable(),
  lwfEnabled: z.boolean(),
  epsStopAge: z.number().int().min(50).max(70),
  pfCeilingProrate: z.boolean(),
  matrixCode: Code,
  payCycleFromDay: z.number().int().min(2).max(28).nullable(),
  otHoursLimit: z.number().min(1).max(744),
  payslipPassword: z.string().trim().max(80).nullable(),
  bankFileFormat: z.enum(['GENERIC_CSV', 'CUSTOM_CSV', 'BANK_LETTER_XLSX']),
  confidentialEmployeeIds: z.array(Id).max(500),
  formulaAttributes: z
    .array(
      z.object({
        code: Code,
        field: z.string().trim().min(1).max(60),
        value: z.string().trim().min(1).max(100),
      }),
    )
    .max(30),
  regimeCutoffMonth: z.number().int().min(1).max(12),
});
export class PayrollSettingsDto extends createZodDto(PayrollSettingsSchema) {}

// ---- the dated rate registry ---------------------------------------------------------------------------
export const CONFIG_KINDS = ['rates', 'pf', 'esi', 'pt', 'lwf', 'ot'] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];
export const ConfigKindSchema = z.enum(CONFIG_KINDS);

export const RateRowSchema = z.object({
  rateCode: Code,
  rateValue: Rate,
  notifiedOn: Day.nullable().optional(),
  source: z.enum(['govt', 'school']).default('school'),
  ...Dated,
});
export const PfRowSchema = z.object({
  eeRate: Rate,
  erRate: Rate,
  epsRate: Rate,
  epsWageCeiling: Dec(),
  edliRate: Rate,
  edliWageCeiling: Dec(),
  edliMin: Dec(),
  adminRate: Rate,
  adminMin: Dec(),
  ...Dated,
});
export const EsiRowSchema = z.object({
  eeRate: Rate,
  erRate: Rate,
  wageLimit: Dec(),
  wageLimitPwd: Dec(),
  ...Dated,
});
export const PtRowSchema = z
  .object({
    stateCode: State,
    gender: z.enum(['M', 'F', 'ANY']),
    wageFrom: Dec(),
    wageTo: Dec().nullable().optional(),
    monthlyAmount: Dec(),
    /** { "2": "300" } — February ₹300 */
    monthOverrides: z
      .record(z.string().regex(/^(1[0-2]|[1-9])$/), Dec())
      .nullable()
      .optional(),
    ...Dated,
  })
  .refine((r) => !r.wageTo || Number(r.wageTo) >= Number(r.wageFrom), {
    message: 'The wage band ends before it starts',
    path: ['wageTo'],
  });
export const LwfRowSchema = z
  .object({
    stateCode: State,
    eeRate: Rate.nullable().optional(),
    eeCap: Dec().nullable().optional(),
    eeFlat: Dec().nullable().optional(),
    erFlat: Dec().nullable().optional(),
    erMultiplier: Dec().nullable().optional(),
    frequency: z.enum(['monthly', 'half_yearly']),
    months: z.array(z.number().int().min(1).max(12)).max(12).nullable().optional(),
    ...Dated,
  })
  .refine((r) => r.eeRate || r.eeFlat, {
    message: 'Give the employee share: a rate or a flat amount',
    path: ['eeFlat'],
  })
  .refine((r) => r.frequency === 'monthly' || (r.months?.length ?? 0) > 0, {
    message: 'Name the months a half-yearly contribution is due in',
    path: ['months'],
  });
export const OtRowSchema = z.object({
  employeeType: z.string().trim().min(1).max(100),
  dailyAmount: Dec(),
  hourlyAmount: Dec(),
  ...Dated,
});
export const CONFIG_SCHEMAS = {
  rates: RateRowSchema,
  pf: PfRowSchema,
  esi: EsiRowSchema,
  pt: PtRowSchema,
  lwf: LwfRowSchema,
  ot: OtRowSchema,
} as const;

export const EndRowSchema = z.object({
  effectiveTo: Day,
  reason: z.string().trim().min(3).max(200),
});
export class EndRowDto extends createZodDto(EndRowSchema) {}

export const ConfigListSchema = z.object({
  status: z.enum(['draft', 'active', 'ended', 'all']).default('all'),
});
export class ConfigListDto extends createZodDto(ConfigListSchema) {}

// ---- income tax by financial year ----------------------------------------------------------------------
const Fy = z.string().regex(/^\d{4}-\d{2}$/, 'a financial year (2026-27)');
export const TaxQuerySchema = z.object({ fy: Fy.optional() });
export class TaxQueryDto extends createZodDto(TaxQuerySchema) {}
/** A new year copied from an earlier one, all or nothing; correct it after. */
export const TaxYearSchema = z.object({ fy: Fy, copyFrom: Fy });
export class TaxYearDto extends createZodDto(TaxYearSchema) {}

// ---- pay heads, versions, formulas ---------------------------------------------------------------------
export const HEAD_CATEGORIES = [
  'BASIC',
  'DA',
  'HRA',
  'ALLOWANCE',
  'ARREAR',
  'BONUS',
  'REIMB',
  'LOAN',
  'STATUTORY',
  'MISC',
] as const;
export const ROUNDING = [
  'NONE',
  'NEAREST_1',
  'FLOOR_1',
  'CEIL_1',
  'NEAREST_10',
  'NEAREST_100',
  'CEIL_100',
] as const;
export const CALC_TYPES = ['FIXED', 'FORMULA', 'SLAB', 'MANUAL', 'SYSTEM'] as const;

const SlabSchema = z
  .object({
    basis: z.enum(['BASIC', 'BASIC_DA', 'GROSS', 'PAY_LEVEL']),
    rangeFrom: Dec(),
    rangeTo: Dec().nullable().optional(),
    flatAmount: Dec().nullable().optional(),
    percent: Dec(4).nullable().optional(),
  })
  .refine((s) => !s.flatAmount !== !s.percent, {
    message: 'A slab is a flat amount or a percent',
  });

export const VersionSchema = z
  .object({
    calcType: z.enum(CALC_TYPES),
    formula: z.string().trim().max(255).nullable().optional(),
    dependsOn: z.string().trim().max(255).nullable().optional(),
    isTaxable: z.boolean(),
    pfWage: z.boolean(),
    esiWage: z.boolean(),
    ptWage: z.boolean(),
    prorateOnLop: z.boolean(),
    rounding: z.enum(ROUNDING),
    slabs: z.array(SlabSchema).max(30).default([]),
    ...Dated,
  })
  .refine((v) => v.calcType !== 'FORMULA' || !!v.formula, {
    message: 'A formula head needs its formula',
    path: ['formula'],
  })
  .refine((v) => v.calcType !== 'SLAB' || v.slabs.length > 0, {
    message: 'A slab head needs its slabs',
    path: ['slabs'],
  });
export class VersionDto extends createZodDto(VersionSchema) {}

export const HeadSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'capital letters, digits and _ (up to 20)'),
  name: z.string().trim().min(1).max(100),
  headType: z.enum(['EARNING', 'DEDUCTION']),
  category: z.enum(HEAD_CATEGORIES),
  printOrder: z.number().int().min(0).max(9999),
  showIfZero: z.boolean().default(false),
  version: VersionSchema,
});
export class HeadDto extends createZodDto(HeadSchema) {}

export const HeadUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(HEAD_CATEGORIES),
  printOrder: z.number().int().min(0).max(9999),
  status: z.enum(['active', 'inactive']),
});
export class HeadUpdateDto extends createZodDto(HeadUpdateSchema) {}

export const FormulaCheckSchema = z.object({
  formula: z.string().max(255),
  pass: z.union([z.literal(1), z.literal(2)]).optional(),
  /** the values to try it with: head codes, rate codes and variables, in rupees / as decimals */
  inputs: z
    .record(
      z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      Rate.or(z.string().regex(/^-\d{1,12}(\.\d{1,6})?$/)),
    )
    .optional(),
});
export class FormulaCheckDto extends createZodDto(FormulaCheckSchema) {}

export const FormulaTestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  inputs: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), Rate),
  expected: Dec(),
});
export class FormulaTestDto extends createZodDto(FormulaTestSchema) {}

// ---- the pay matrix ------------------------------------------------------------------------------------
export const MatrixCellSchema = z.object({
  matrixCode: Code,
  payLevel: z.string().trim().min(1).max(20),
  levelOrder: z.number().int().min(0).max(999),
  cellNo: z.number().int().min(1).max(60),
  basic: Dec(),
  effectiveFrom: Day,
});
export class MatrixCellDto extends createZodDto(MatrixCellSchema) {}
export const MatrixQuerySchema = z.object({ code: Code.optional() });
export class MatrixQueryDto extends createZodDto(MatrixQuerySchema) {}

// ---- profiles, nominees, reveal ------------------------------------------------------------------------
export const ProfileListSchema = z.object({
  q: z.string().trim().max(60).optional(),
  profile: z.enum(['all', 'missing', 'present']).default('all'),
  status: z.enum(['ACTIVE', 'HOLD', 'LEFT']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(25),
});
export class ProfileListDto extends createZodDto(ProfileListSchema) {}

export const ProfileSchema = z
  .object({
    pfApplicable: z.boolean(),
    pfWageBasis: z.enum(['ACTUAL', 'CEILING']),
    epsApplicable: z.boolean(),
    vpfType: z.enum(['NONE', 'FLAT', 'PERCENT']),
    vpfValue: Dec(),
    npsApplicable: z.boolean(),
    npsEeRate: Rate,
    npsErRate: Rate,
    esiApplicable: z.boolean(),
    pwd: z.boolean(),
    ptApplicable: z.boolean(),
    ptExemptReason: z.string().trim().max(60).nullable(),
    taxRegime: z.enum(['NEW', 'OLD']),
    tdsMode: z.enum(['PROJECTION', 'MANUAL']),
    category: z.string().trim().max(50).nullable(),
    payLevel: z.string().trim().max(20).nullable(),
    payCell: z.number().int().min(1).max(60).nullable(),
    contractStart: Day.nullable(),
    contractEnd: Day.nullable(),
    incrementMonth: z.number().int().min(1).max(12).nullable(),
    payrollStatus: z.enum(['ACTIVE', 'HOLD', 'LEFT']),
    payMode: z.enum(['BANK', 'CASH', 'CHEQUE']),
    /** the date the changes to switches, regime, level / cell or status take effect */
    changesFrom: Day,
  })
  .refine((p) => p.ptApplicable || !!p.ptExemptReason, {
    message: 'Say why profession tax does not apply',
    path: ['ptExemptReason'],
  })
  .refine((p) => !(p.payLevel && !p.payCell) && !(!p.payLevel && p.payCell), {
    message: 'A pay level goes with a cell',
    path: ['payCell'],
  })
  .refine((p) => !p.contractEnd || !p.contractStart || p.contractEnd >= p.contractStart, {
    message: 'The contract ends before it starts',
    path: ['contractEnd'],
  });
export class ProfileDto extends createZodDto(ProfileSchema) {}

export const NomineesSchema = z.object({
  nominees: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(150),
        relation: z.string().trim().min(1).max(40),
        dob: Day.nullable().optional(),
        sharePercent: Dec(2),
        purpose: z.enum(['GRATUITY', 'EDLI', 'GENERAL']),
        guardianName: z.string().trim().max(150).nullable().optional(),
        address: z.string().trim().max(255).nullable().optional(),
      }),
    )
    .max(20),
});
export class NomineesDto extends createZodDto(NomineesSchema) {}

export const RevealSchema = z.object({
  field: z.enum(['pan', 'aadhaar', 'bank_account_no']),
  reason: z.string().trim().min(5).max(200),
});
export class RevealDto extends createZodDto(RevealSchema) {}

export const SyncSchema = z.object({
  dryRun: z.boolean().default(true),
  employeeIds: z.array(Id).max(2000).optional(),
});
export class SyncDto extends createZodDto(SyncSchema) {}

// ---- salary structures and templates -------------------------------------------------------------------
export const StructureSchema = z.object({
  effectiveFrom: Day,
  changeReason: z.string().trim().min(3).max(200),
  lines: z
    .array(z.object({ payHeadId: Id, amount: Dec() }))
    .min(1)
    .max(60),
});
export class StructureDto extends createZodDto(StructureSchema) {}

export const EmployeesSchema = z.object({ employeeIds: z.array(Id).min(1).max(2000) });
export class EmployeesDto extends createZodDto(EmployeesSchema) {}

export const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(255).nullable(),
  staffTypes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  lines: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/), Dec()),
});
export class TemplateDto extends createZodDto(TemplateSchema) {}

export const StructureImportSchema = z.object({
  file: z.string().min(10).max(8_000_000),
  dryRun: z.boolean().default(true),
  changeReason: z.string().trim().min(3).max(200).default('Structures from Excel'),
});
export class StructureImportDto extends createZodDto(StructureImportSchema) {}

export const DraftsQuerySchema = z.object({ q: z.string().trim().max(60).optional() });
export class DraftsQueryDto extends createZodDto(DraftsQuerySchema) {}
