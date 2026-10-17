/** Shared bits of the hostel incident pages. */
export interface Incident {
  id: string;
  studentId: string;
  name: string;
  admissionNo: string;
  hostelId: string;
  hostel: string;
  occurredAt: string;
  category: string;
  severity: 'minor' | 'serious';
  what: string;
  action: string | null;
  tellParent: boolean;
  parentToldAt: string | null;
  principalToldAt: string | null;
  recordedBy: string | null;
  status: 'open' | 'follow_up' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
  closingRemark: string | null;
  files?: number;
  notes?: number;
}
export const INCIDENT_CATEGORIES = [
  ['discipline', 'Discipline'],
  ['health', 'Health'],
  ['safety', 'Safety'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const;
export const INCIDENT_STATUS: Record<Incident['status'], [string, 'warning' | 'info' | 'success']> =
  {
    open: ['Open', 'warning'],
    follow_up: ['In follow-up', 'info'],
    closed: ['Closed', 'success'],
  };
export const incidentWhen = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
