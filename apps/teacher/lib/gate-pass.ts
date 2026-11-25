/** Gate passes on the staff website (0069): the shape the lists read and how they show a pass. */
export interface Pass {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  kind: 'early_leave' | 'late_arrival' | 'rgp' | 'nrgp' | 'hostel_home' | 'hostel_outing';
  state: string;
  stage: string;
  /** the stage in the person's language (made on the server) */
  stageLabel?: string;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  reason: string;
  destination: string | null;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
  employee: string | null;
  employeeCode: string | null;
  escortName: string | null;
  escortRelation: string | null;
  approvedLevels: number;
  levels: number;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  waitingOn: string | null;
  passNo: string | null;
  items: number;
  decisionNote: string | null;
  outAt: string | null;
  inAt: string | null;
}
export const PASS_KIND: Record<Pass['kind'], string> = {
  early_leave: 'Early leave',
  late_arrival: 'Late arrival',
  rgp: 'RGP · returnable',
  nrgp: 'NRGP · non-returnable',
  hostel_home: 'Hostel home leave',
  hostel_outing: 'Hostel outing',
};
export const PASS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'info' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  handed_over: 'info',
  out: 'info',
  returned: 'neutral',
};
export const passTime = (v: string) =>
  new Date(v).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
/** The return time, with its day when that is not the day the pass is for (hostel home leave). */
export const passBackBy = (p: { returnBy: string | null; onDate: string }) => {
  if (!p.returnBy) return '';
  const day = new Date(new Date(p.returnBy).getTime() + 5.5 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  return day === p.onDate
    ? passTime(p.returnBy)
    : new Date(p.returnBy).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
};
export const passWho = (p: Pass, adm: string) =>
  p.audience === 'student'
    ? `${p.student ?? ''}${p.section ? ` (${p.section})` : ''}${p.admissionNo ? ` · ${adm} ${p.admissionNo}` : ''}`
    : `${p.employee ?? ''}${p.employeeCode ? ` · ${p.employeeCode}` : ''}`;
