/** The student and employee dashboards (people/dashboard/students, /staff). */
export interface Count {
  key: string;
  n: number;
}
export interface StudentDashboard {
  year: { id: string; code: string };
  strength: {
    total: number;
    newThisYear: number;
    old: number;
    ews: number;
    byClass: Array<{
      classId: string;
      name: string;
      sections: number;
      students: number;
      boys: number;
      girls: number;
    }>;
    gender: Count[];
    category: Count[];
    boarding: Count[];
  };
  movement: {
    admittedYear: number;
    admittedMonth: number;
    withdrawn: number;
    tcsIssued: number;
    transferredOut: number;
    transferredIn: number;
  };
  today: {
    sections: number;
    sectionsMarked: number;
    present: number;
    absent: number;
    leave: number;
    birthdays: Array<{ id: string; name: string; section: string; age: number }>;
  };
  health: {
    averageCompleteness: number | null;
    below80: number;
    noPhoto: number;
    noAadhaar: number;
    pendingChanges: number;
  };
}
export interface StaffDashboard {
  year: { id: string; code: string } | null;
  strength: {
    total: number;
    side: Count[];
    department: Count[];
    designation: Count[];
    type: Count[];
    gender: Count[];
  };
  movement: {
    joined: number;
    left: number;
    transfersRecorded: number;
    transferredOut: number;
    transferredIn: number;
    probationEnding30: number;
    retiring12Months: number;
  };
  today: {
    punchedIn: number;
    late: number;
    lateAfter: string;
    activityLogs: number;
    people: Array<{
      id: string;
      name: string;
      designation: string | null;
      kind: 'birthday' | 'anniversary';
      years: number;
    }>;
  };
  health: {
    averageCompleteness: number | null;
    below80: number;
    noLogin: number;
    documentsMissing: number;
    documentsExpiring30: number;
    pendingChanges: number;
    acr: { cycle: string | null; byStatus: Record<string, number> } | null;
  };
}
export const TONES = ['navy', 'cyan', 'success', 'warning', 'info', 'danger', 'muted'] as const;
