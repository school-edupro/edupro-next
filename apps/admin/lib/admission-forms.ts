/** Admission form builder shapes (docs/design/39, part 1); the engine types come from @edupro/ui. */
import type { AdmissionFormDef } from '@edupro/ui';

export interface FormListRow {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  steps: number;
  fields: number;
  classes: number;
  updatedAt: string;
}

export interface FormDetail {
  id: string;
  name: string;
  description: string | null;
  def: AdmissionFormDef;
  status: 'active' | 'archived';
  template: string | null;
  usedBy: Array<{ cycle: string; className: string }>;
  updatedAt: string;
  updatedBy: string | null;
  options: Record<string, string[]>;
}

export interface FormMeta {
  templates: Array<{ id: string; name: string; steps: number; fields: number }>;
  options: Record<string, string[]>;
  lists: string[];
  studentFields: Array<{
    key: string;
    label: string;
    section: string;
    type: string;
    list: string | null;
  }>;
  extraFields: Array<{ key: string; label: string; type: string; list: string | null }>;
  docKinds: Array<{ id: string; label: string }>;
}
