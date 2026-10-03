/** The visitor gate pass (0065): the shapes the screens share with the API, and labels. */
export type VisitorState = 'waiting' | 'inside' | 'left' | 'cancelled';
export interface Visitor {
  id: string;
  number: string;
  passCode: string | null;
  source: 'gate' | 'self' | 'appointment';
  state: VisitorState;
  visitorName: string;
  mobile: string | null;
  email: string | null;
  organisation: string | null;
  visitorType: string | null;
  partySize: number;
  idProofKind: string | null;
  idProofLast4: string | null;
  vehicleNo: string | null;
  equipment: string | null;
  purpose: string;
  hostId: string | null;
  toMeet: string | null;
  gate: string | null;
  exitGate: string | null;
  exitNote: string | null;
  badgeNo: string | null;
  inAt: string | null;
  outAt: string | null;
  createdAt: string;
  appointmentId: string | null;
  loggedBy: string | null;
  hasPhoto: boolean;
}
export interface VisitorList {
  data: Visitor[];
  page: { number: number; size: number; total: number };
  counts: { inside: number; waiting: number; today: number; peopleInside: number };
}
export interface VisitorOptions {
  types: string[];
  gates: string[];
  idProofKinds: string[];
  purposes: string[];
  selfEnabled: boolean;
  hosts: Array<{ id: string; name: string; person: string | null }>;
}
export interface VisitorLookup {
  visits: number;
  last: {
    visitorName: string;
    organisation: string | null;
    visitorType: string | null;
    email: string | null;
    idProofKind: string | null;
    idProofLast4: string | null;
    vehicleNo: string | null;
    hostId: string | null;
    lastVisit: string;
    stillInside: boolean;
  } | null;
}
export const VISITOR_STATE: Record<VisitorState, string> = {
  waiting: 'Waiting at the gate',
  inside: 'Inside',
  left: 'Left',
  cancelled: 'Not let in',
};
export const VISITOR_TONE: Record<VisitorState, 'warning' | 'success' | 'neutral' | 'danger'> = {
  waiting: 'warning',
  inside: 'success',
  left: 'neutral',
  cancelled: 'danger',
};
export const VISITOR_SOURCE = { gate: 'Gate', self: 'Own phone', appointment: 'Appointment' };
