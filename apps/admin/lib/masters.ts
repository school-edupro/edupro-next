import { apiFetch } from './api';

/** Registry entry as the API serves it (packages/db/src/masters.ts, filtered to the caller). */
export interface MasterField {
  key: string;
  header: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'ref';
  required?: boolean;
  identity?: boolean;
  readOnly?: boolean;
  options?: string[];
  lookup?: { table: string; column: string; yearScoped?: boolean };
  scale?: number;
  min?: number;
  max?: number;
  maxLength?: number;
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
  canClone: boolean;
  naturalKey: string[];
  status: { column: string; values: string[] } | null;
  fields: MasterField[];
  columns: Array<{ key: string; header: string; type?: string; width?: number }>;
  uploadHelp: string | null;
  dataset: string;
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
  'system',
] as const;

export async function masterRegistry(): Promise<MasterMeta[]> {
  return apiFetch<{ data: MasterMeta[] }>('/masters').then((r) => r.data);
}
