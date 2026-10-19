/** My employee profile in the staff app (me/employee-profile, docs/design/33-people-dashboards.md). */
export type Level = 'hidden' | 'view' | 'edit_approval' | 'edit_direct';
export type Value = string | number | boolean | null;
export interface MyField {
  key: string;
  label: string;
  type: string;
  level: Level;
  value: Value;
  options: string[] | null;
  help: string | null;
  required: boolean;
  upper: boolean;
  when: { key: string; in?: string[]; notIn?: string[] } | null;
  proof: { typeId: string; name: string } | null;
  pending?: Value;
}
export interface MyRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'partially_approved' | 'cancelled';
  autoApplied: boolean;
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  reason: string | null;
  step: { at: number; of: number; with: string } | null;
  /** 0188: the file ids of a photo change (the fields list reads "Photo on file → New photo") */
  photo: { from: string | null; to: string } | null;
  fields: Array<{
    key: string;
    label: string;
    from: Value;
    to: Value;
    status: string;
    note: string | null;
    /** 0187: the file of a document row change, opened through the app's own file route */
    file?: string | null;
  }>;
}
export interface MyProfile {
  employee: { id: string; name: string; code: string; photo: string | null; status: string };
  sections: Array<{ id: string; title: string; fields: MyField[] }>;
  /** 0187: education, languages, experience and documents */
  lists: MyList[];
  /** 0188: my photo, what I may do with it, and a new one waiting for approval */
  photo: { fileId: string | null; level: Level; pending: string | null };
  window: { open: boolean; message: string | null; until: string | null };
  canEdit: boolean;
  completeness: { percent: number; missing: string[] };
  requests: MyRequest[];
}
export const editable = (f: MyField) => f.level === 'edit_approval' || f.level === 'edit_direct';
export const shown = (v: Value): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : s;
};

// ---- 0187: the row lists (education, languages, experience, documents) --------------------------
export type MyListKind = 'education' | 'languages' | 'experience' | 'documents';
export interface MyListColumn {
  key: string;
  label: string;
  type: 'text' | 'year' | 'date' | 'boolean' | 'select' | 'doctype' | 'file';
  list?: string;
  required?: boolean;
  max?: number;
  options: string[] | Array<{ id: string; name: string; hasExpiry: boolean }> | null;
}
export type MyRowData = Record<string, string | number | boolean | null>;
export interface MyListRow {
  id: string;
  values: MyRowData;
  summary: string;
  pending: { key: string; op: 'edit' | 'remove'; data: MyRowData | null } | null;
}
export interface MyList {
  id: MyListKind;
  title: string;
  level: Level;
  proof: { typeId: string; name: string } | null;
  columns: MyListColumn[];
  rows: MyListRow[];
  pendingAdds: Array<{ key: string; data: MyRowData; summary: string }>;
}
export const listEditable = (l: MyList) => l.level === 'edit_approval' || l.level === 'edit_direct';
