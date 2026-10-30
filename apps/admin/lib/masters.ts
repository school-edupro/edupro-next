import { apiFetch } from './api';

/** Registry entry as the API serves it (packages/db/src/masters.ts, filtered to the caller). */
export interface MasterField {
  key: string;
  header: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'ref';
  required?: boolean;
  identity?: boolean;
  readOnly?: boolean;
  /** a column worked out per row (a count): shown, never typed */
  expr?: string;
  /** this key may change only while that count of the row is 0; `help` says why it is locked */
  lockedWhen?: { field: string; help: string };
  options?: string[];
  lookup?: {
    table: string;
    column: string;
    yearScoped?: boolean;
    labelColumn?: string;
    showLabel?: boolean;
    nameFirst?: boolean;
    parent?: { table: string; column: string; valueColumn: string; label: string };
  };
  scale?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  patternHelp?: string;
  input?: 'email' | 'tel' | 'url';
  notBefore?: string;
  after?: string;
  notSelf?: boolean;
  widget?: 'map';
  width?: number;
  bulk?: boolean;
  array?: boolean;
  help?: string;
}

export interface MasterMeta {
  id: string;
  title: string;
  group: string;
  yearScoped: boolean;
  canManage: boolean;
  /** Excel upload: as canManage, or kept for a master another screen owns */
  canUpload?: boolean;
  canClone: boolean;
  /** owned by another screen; opened from there, not listed */
  hidden?: boolean;
  /** the screen that changes these rows (the grid lists and exports them) */
  editVia?: { path: string; label: string } | null;
  naturalKey: string[];
  editableKeys?: string[];
  status: { column: string; values: string[] } | null;
  fields: MasterField[];
  columns: Array<{ key: string; header: string; type?: string; width?: number }>;
  uploadHelp: string | null;
  dataset: string;
  /** also a tab of these setup pages */
  alsoIn?: string[];
  order?: number;
  /** a row opens its own screen */
  detail?: { path: string; label: string } | null;
  /** a duplicate can be merged into a row; `note` says what moves */
  merge?: { note: string } | null;
  /** where each drop-down that points at another master gets its list */
  sources?: Record<string, MasterSource>;
}

/** The setup page and tab a drop-down's list is kept on. */
export interface MasterSource {
  id: string;
  group: string;
  title: string;
  groupTitle: string;
  canView: boolean;
}

export interface MasterRow extends Record<string, string | null> {
  id: string;
}

export interface MasterImport {
  id: string;
  master: string;
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  insertedRows: number;
  updatedRows: number;
  report: Array<{ row: number; column: string; message: string }>;
  requestedBy: string | null;
  createdAt: string;
  committedAt: string | null;
}

export const MASTER_GROUP_IDS = [
  'fees',
  'academics',
  'attendance',
  'transport',
  'exams',
  'communication',
  'library',
  'staff',
  'system',
] as const;

export async function masterRegistry(): Promise<MasterMeta[]> {
  return apiFetch<{ data: MasterMeta[] }>('/masters').then((r) => r.data);
}

/** One option of a ref field's datalist (`/masters/:id/lookups`). */
export interface MasterLookupOption {
  id: string;
  value: string;
  parent: string | null;
  label: string | null;
}
