import type { Permission } from './types';

/**
 * Role permissions as a grid: one row per feature (module.resource), one column per kind of right.
 * The permission codes themselves do not change; this only decides where each tick is shown.
 */
export type MatrixColumn = 'view' | 'write' | 'delete' | 'approve' | 'other';

export const MATRIX_COLUMNS: Array<{ key: MatrixColumn; label: string; help: string }> = [
  { key: 'view', label: 'View', help: 'Open the screen and read the data' },
  { key: 'write', label: 'Add / Edit', help: 'Create and change records' },
  { key: 'delete', label: 'Delete', help: 'Remove records' },
  { key: 'approve', label: 'Approve', help: 'Approve, reject, lock or close' },
  { key: 'other', label: 'Other actions', help: 'Special actions of this feature' },
];

const COLUMN_OF: Record<string, MatrixColumn> = {
  view: 'view',
  viewall: 'view',
  search: 'view',
  track: 'view',
  report: 'view',
  manage: 'write',
  create: 'write',
  edit: 'write',
  enter: 'write',
  upload: 'write',
  post: 'write',
  issue: 'write',
  mark: 'write',
  import: 'write',
  generate: 'write',
  raise: 'write',
  request: 'write',
  apply: 'write',
  respond: 'write',
  answer: 'write',
  setup: 'write',
  change: 'write',
  delete: 'delete',
  erase: 'delete',
  approve: 'approve',
  decide: 'approve',
  review: 'approve',
  verify: 'approve',
  lock: 'approve',
  close: 'approve',
  reopen: 'approve',
};

const MODULE_LABEL: Record<string, string> = {
  academics: 'Academics',
  access: 'Access (roles and users)',
  admissions: 'Admissions',
  attendance: 'Attendance',
  comms: 'Communication',
  compat: 'Teacher app (old)',
  engagement: 'Front office and parent engagement',
  exams: 'Exams and report cards',
  fees: 'Fees',
  helpdesk: 'Help desk',
  insights: 'Dashboards and MIS',
  library: 'Library',
  payments: 'Online payments',
  people: 'Students and staff',
  platform: 'School set-up and security',
  reports: 'Report builder',
  staff: 'Staff activity',
  transport: 'Transport',
  workflow: 'Approvals',
};

const WORD: Record<string, string> = {
  tc: 'Transfer certificate',
  mis: 'MIS',
  rfid: 'RFID',
  gps: 'GPS',
  cctv: 'CCTV',
  master: 'Masters (set-up lists)',
  family: 'Parent portal (own children)',
  viewall: 'View all',
  ack: 'Acknowledge',
};

const words = (s: string) => {
  if (WORD[s]) return WORD[s];
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export interface MatrixTick {
  code: string;
  /** The action word shown beside the tick: View, Manage, Post … */
  label: string;
  description: string;
  requiresMfa: boolean;
}

export interface MatrixRow {
  key: string;
  label: string;
  cells: Record<MatrixColumn, MatrixTick[]>;
  codes: string[];
}

export interface MatrixModule {
  key: string;
  label: string;
  rows: MatrixRow[];
  codes: string[];
}

export function buildMatrix(permissions: Permission[]): MatrixModule[] {
  const modules = new Map<string, Map<string, MatrixRow>>();
  for (const p of permissions) {
    const [, resource = '', action = ''] = p.code.split('.');
    const rows = modules.get(p.module) ?? new Map<string, MatrixRow>();
    modules.set(p.module, rows);
    const row = rows.get(resource) ?? {
      key: `${p.module}.${resource}`,
      label: words(resource),
      cells: { view: [], write: [], delete: [], approve: [], other: [] },
      codes: [],
    };
    rows.set(resource, row);
    row.cells[COLUMN_OF[action] ?? 'other'].push({
      code: p.code,
      label: words(action),
      description: p.description,
      requiresMfa: p.requiresMfa,
    });
    row.codes.push(p.code);
  }
  return [...modules.entries()]
    .map(([key, rows]) => {
      const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
      return {
        key,
        label: MODULE_LABEL[key] ?? words(key),
        rows: list,
        codes: list.flatMap((r) => r.codes),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The codes of one column inside a module (for "tick the whole column"). */
export const columnCodes = (m: MatrixModule, col: MatrixColumn): string[] =>
  m.rows.flatMap((r) => r.cells[col].map((t) => t.code));
