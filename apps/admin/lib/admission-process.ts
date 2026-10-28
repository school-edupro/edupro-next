/** The approval process of online admission (docs/design/39, part 4). */
export type StageKind =
  'document_check' | 'test' | 'interview' | 'interaction' | 'selection' | 'custom';
export type LevelBy = 'anyone' | 'role' | 'designation' | 'employees';

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  maxMarks: number | null;
  status: 'active' | 'inactive';
  used: boolean;
}
export interface ProcessLevel {
  name: string;
  by: LevelBy;
  roleCode?: string | null;
  designation?: string | null;
  employeeIds?: string[];
  /** days to decide at this level (none: no time limit; docs/design/47) */
  days?: number | null;
}
export interface ProcessStep {
  stageId: string;
  levels: ProcessLevel[];
}
export interface Process {
  id: string;
  name: string;
  steps: ProcessStep[];
  classIds: string[];
  classNames: string[];
}
export interface ProcessSetup {
  stages: Stage[];
  processes: Process[];
  classes: Array<{ id: string; name: string }>;
  roles: Array<{ code: string; name: string }>;
  designations: string[];
  employees: Array<{ id: string; name: string }>;
}

export const STAGE_KIND: Record<StageKind, string> = {
  document_check: 'Document check (papers, category)',
  test: 'Written test (slots, marks)',
  interview: 'Interview (slots, marks)',
  interaction: 'Interaction (slots)',
  selection: 'Selection (offer, waiting list)',
  custom: 'Other approval',
};

export interface JourneyLevel {
  no: number;
  name: string;
  by: LevelBy;
  result: {
    id: string;
    decision: 'approved' | 'rejected' | 'hold' | 'offered' | 'waitlisted';
    attendance: string | null;
    marks: number | null;
    maxMarks: number | null;
    remarks: string | null;
    by: string | null;
    at: string;
  } | null;
}
export interface JourneyStep {
  stageId: string;
  name: string;
  kind: StageKind;
  maxMarks: number | null;
  state: 'done' | 'current' | 'waiting' | 'rejected';
  /** marks by part of a test or interview (docs/design/57) */
  byPart?: StageMarks | null;
  levels: JourneyLevel[];
}
export interface StageMarks {
  parts: Array<{ name: string; max: number; marks: number | null }>;
  total: number | null;
  maxTotal: number | null;
  absent: boolean;
  remark: string | null;
}
/** "English 40/50 · Maths 48/50 · total 88/100", or "Absent". */
export const marksLine = (m: StageMarks) =>
  m.absent
    ? 'Absent'
    : [
        ...m.parts.map((p) => `${p.name} ${p.marks ?? '-'}/${String(p.max)}`),
        ...(m.total !== null ? [`total ${String(m.total)}/${String(m.maxTotal ?? '-')}`] : []),
      ].join(' · ');
export interface RegistrationRow {
  id: string;
  number: string | null;
  status: string;
  candidate: string | null;
  className: string;
  session: string;
  category: string | null;
  mobile: string | null;
  registeredAt: string | null;
  submittedAt: string | null;
  stage: string | null;
  stageKind: string | null;
  level: string | null;
  merit: number | null;
  waitRank: number | null;
  offerExpiresAt: string | null;
  feeDue: number;
  byOffice: boolean;
}
export interface SlotInfo {
  slotId: string;
  stageId: string;
  stage: string;
  startsAt: string;
  minutes: number;
  venue: string;
  notes: string | null;
  rollNo: number;
}
export interface SlotRow {
  id: string;
  stageId: string;
  stage: string;
  kind: string;
  classId: string | null;
  className: string | null;
  startsAt: string;
  minutes: number;
  venue: string;
  capacity: number;
  notes: string | null;
  allotted: number;
  marked: number;
}
export interface SlotDetail {
  id: string;
  session: { id: string; name: string };
  stageId: string;
  stage: string;
  kind: string;
  maxMarks: number | null;
  classId: string | null;
  className: string | null;
  startsAt: string;
  minutes: number;
  venue: string;
  capacity: number;
  notes: string | null;
  waiting: number;
  candidates: Array<{
    applicationId: string;
    rollNo: number;
    number: string | null;
    candidate: string | null;
    className: string;
    status: string;
    atStage: boolean;
    notified: boolean;
    attendance: string | null;
    marks: number | null;
    classId: string;
    /** the candidate's class paper (docs/design/57): marks part by part */
    parts: Array<{ id: string; name: string; maxMarks: number }> | null;
    partMarks: Record<string, number | null>;
    decision: string | null;
    remarks: string | null;
  }>;
}
export interface SelectionRow {
  id: string;
  number: string | null;
  candidate: string | null;
  categoryId: string | null;
  category: string | null;
  status: string;
  merit: number | null;
  waitRank: number | null;
  registeredAt: string | null;
  offerExpiresAt: string | null;
  level: string | null;
}
export interface Selection {
  session: { id: string; name: string; offerDays: number };
  class: { id: string; name: string; seats: number; taken: number; left: number };
  lapsed: number;
  categories: Array<{
    id: string;
    name: string;
    seats: number | null;
    offered: number;
    paid: number;
  }>;
  /** at Selection, in merit-list order (docs/design/40, part 4) */
  merit: Array<
    SelectionRow & {
      rank: number;
      points: number | null;
      marks: number | null;
      dob: string | null;
      /** how the place among equal merits was settled */
      tie: 'age' | 'draw' | null;
    }
  >;
  tieBreak: { rule: string; seed: string | null; seededAt: string | null };
  waiting: SelectionRow[];
  offered: SelectionRow[];
}

export const whenIst = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : '';
