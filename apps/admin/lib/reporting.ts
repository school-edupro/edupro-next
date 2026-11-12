/** Reporting managers (docs/design/30): who each active employee reports to in the working year. */
export interface ReportingList {
  year: { id: string; name: string | null };
  figures: { staff: number; set: number; none: number; managers: number };
  rows: Array<{
    id: string;
    code: string | null;
    name: string;
    department: string | null;
    designation: string | null;
    manager: { id: string; code: string | null; name: string | null } | null;
    reportees: number;
  }>;
  total: number;
  page: number;
  size: number;
  lists: {
    employees: Array<{ id: string; name: string }>;
    managers: Array<{ id: string; name: string; reportees: number }>;
    departments: string[];
    designations: string[];
  };
}

export type ReportingImportResult =
  | {
      ok: true;
      rows: Array<{
        row: number;
        employee: string;
        from: string | null;
        to: string | null;
        status: 'change' | 'same' | 'error';
        error?: string;
      }>;
      counts: { change: number; same: number; error: number };
      saved: number;
      waiting: number;
    }
  | { ok: false; error: string };
