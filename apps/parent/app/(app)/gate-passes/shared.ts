/** What the gate pass screens of the parent app share: shapes, status words and labels. */
export type PassState =
  'pending' | 'approved' | 'rejected' | 'cancelled' | 'handed_over' | 'out' | 'returned';
export interface Pass {
  id: string;
  number: string;
  kind: 'early_leave' | 'late_arrival' | 'hostel_home' | 'hostel_outing';
  state: PassState;
  returnBy?: string | null;
  onDate: string;
  atTime: string | null;
  reason: string;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
  escortName: string | null;
  escortRelation: string | null;
  approvedLevels: number;
  levels: number;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  waitingOn: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  passNo: string | null;
  passCode: string | null;
  handoverAt?: string | null;
  outAt?: string | null;
  inAt?: string | null;
}
/** What the family reads for each state (and for a late arrival, where "out" never happens). */
export function stateOf(
  p: Pick<Pass, 'state' | 'kind'>,
): [string, 'warning' | 'success' | 'danger' | 'info' | 'neutral'] {
  switch (p.state) {
    case 'pending':
      return ['Waiting for the school', 'warning'];
    case 'approved':
      return [
        p.kind === 'early_leave'
          ? 'Approved: collect at the front desk'
          : p.kind === 'hostel_home'
            ? 'Approved: collect from the hostel warden'
            : 'Approved',
        'success',
      ];
    case 'handed_over':
      return [
        p.kind === 'hostel_home' ? 'Handed over at the hostel' : 'Handed over at the front desk',
        'info',
      ];
    case 'out':
      return [
        p.kind === 'hostel_home' || p.kind === 'hostel_outing' ? 'Out on leave' : 'Left the school',
        'neutral',
      ];
    case 'returned':
      return [
        p.kind === 'hostel_home' || p.kind === 'hostel_outing' ? 'Back in the hostel' : 'Came in',
        'neutral',
      ];
    case 'rejected':
      return ['Not approved', 'danger'];
    default:
      return ['Cancelled', 'neutral'];
  }
}
export const KIND: Record<Pass['kind'], string> = {
  early_leave: 'Leaving early',
  late_arrival: 'Arriving late',
  hostel_home: 'Home leave (hostel)',
  hostel_outing: 'Outing (hostel)',
};
/** 05 / Oct Mon for the date block of a card, from a plain date. */
export const dateParts = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return {
    day: x.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit' }),
    month: x.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short', weekday: 'short' }),
  };
};
