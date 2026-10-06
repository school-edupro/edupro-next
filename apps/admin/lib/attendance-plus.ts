/** Attendance, completed (0083): the shapes the dashboard, bus roll, registers and set-up screens share. */
export interface Windows {
  classFrom: string | null;
  classTo: string | null;
  busPickFrom: string | null;
  busPickTo: string | null;
  busDropFrom: string | null;
  busDropTo: string | null;
  backDays: number;
  configured: boolean;
}
export interface TripTotals {
  riders: number;
  routes: number;
  markedRoutes: number;
  present: number;
  absent: number;
  leave: number;
  gatePass: number;
  other: number;
  unmarked: number;
}
export interface AttendanceDashboard {
  date: string;
  windows: Windows;
  class: {
    strength: number;
    sections: number;
    markedSections: number;
    present: number;
    absent: number;
    leave: number;
    late: number;
    unmarked: number;
    percent: number | null;
    markedLate: number;
    pending: Array<{ id: string; name: string; teacher: string | null }>;
  };
  bus: {
    pick: TripTotals;
    drop: TripTotals;
    pending: Array<{
      routeId: string;
      code: string;
      trip: 'pick' | 'drop';
      teachers: string | null;
    }>;
  };
  known: { leave: number; earlyLeave: number; lateArrival: number };
  trend: Array<{
    date: string;
    percent: number | null;
    present: number;
    pick: number;
    drop: number;
  }>;
}
export interface BusSummaryRow {
  routeId: string;
  code: string;
  name: string;
  trip: 'pick' | 'drop';
  tripLabel: string;
  riders: number;
  marked: boolean;
  present: number;
  absent: number;
  leave: number;
  gatePass: number;
  other: number;
  unmarked: number;
  markedBy: string | null;
  markedAt: string | null;
  markedLate: boolean;
  teachers: string | null;
}
export interface DayHint {
  leave: { number: string; from: string; to: string } | null;
  pass: { kind: 'early_leave' | 'late_arrival'; number: string; atTime: string | null } | null;
}
export interface BusRoll {
  id: string | null;
  routeId: string;
  route: string;
  vehicle: string | null;
  date: string;
  trip: 'pick' | 'drop';
  tripLabel: string;
  markedBy: string | null;
  markedLate: boolean;
  window: {
    open: boolean;
    late: boolean;
    from: string | null;
    to: string | null;
    note: string | null;
  };
  roster: Array<{
    studentId: string;
    name: string;
    admissionNo: string | null;
    section: string | null;
    stop: string | null;
    atTime: string | null;
    code: string | null;
    remarks: string | null;
    hint: DayHint | null;
    classCode: string | null;
    tapped: string | null;
    suggested: string | null;
  }>;
  counts: Record<string, number>;
}
export interface AttendanceSetup {
  windows: Windows;
  routeTeachers: Array<{
    routeId: string;
    trip: 'pick' | 'drop';
    employeeId: string;
    name?: string;
    code?: string | null;
    route?: string;
    login?: boolean;
  }>;
  routes: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; teacher: string | null }>;
  reopens: Array<{
    id: string;
    date: string;
    openUntil: string;
    open: boolean;
    what: string;
    reason: string;
    by: string | null;
  }>;
}
export const BUS_CODES: Array<[string, string]> = [
  ['P', 'On the bus'],
  ['A', 'Not on the bus'],
  ['LV', 'On leave'],
  ['GP', 'Gate pass'],
  ['OT', 'Other arrangement'],
];
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
export const windowText = (from: string | null, to: string | null) =>
  from || to ? `${from ?? 'start of day'} – ${to ?? 'end of day'}` : 'any time';
