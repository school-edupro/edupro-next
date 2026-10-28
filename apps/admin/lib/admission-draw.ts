/** Draw of lots: slips for a total of the form's merit points, their settings, the hand draw recorded (docs/design/60, 62). */

export const SLIP_FIELDS = [
  ['photo', 'Photo'],
  ['name', "Candidate's name"],
  ['father', "Father's name"],
  ['mother', "Mother's name"],
  ['dob', 'Date of birth'],
  ['number', 'Registration no.'],
  ['sno', 'S.No.'],
  ['points', 'Form points'],
  ['merit', 'Merit total'],
  ['merit_no', 'Merit no.'],
  ['category', 'Category'],
  ['session', 'Session'],
  ['draw', 'Draw date and venue'],
] as const;
export type SlipField = (typeof SLIP_FIELDS)[number][0];

export interface DrawOptions {
  cycles: Array<{
    id: string;
    name: string;
    /** withPoints: registered candidates with merit points who may still be drawn */
    classes: Array<{ id: string; name: string; withPoints: number }>;
  }>;
  categories: Array<{ id: string; name: string }>;
}
export interface DrawPlace {
  cycle: string;
  className: string;
  category: string | null;
}
export interface DrawTotals {
  place: DrawPlace;
  totals: Array<{ points: string; candidates: number; confirmed: number }>;
}
export interface DrawTwin {
  ids: string[];
  state: 'found' | 'paired' | 'split';
}
export interface DrawGroup {
  place: DrawPlace;
  points: string;
  candidates: Array<{
    id: string;
    number: string;
    candidate: string | null;
    father: string | null;
    dob: string | null;
    category: string | null;
    stage: string | null;
    points: string;
    merit: string | null;
    meritNo: string | null;
    /** Document check has confirmed the points (a slip prints either way) */
    confirmed: boolean;
  }>;
  twins: DrawTwin[];
  slips: number;
}
export interface DrawSettings {
  heading: string;
  fields: SlipField[];
  drawAt: string | null;
  venue: string | null;
  footer: string | null;
  perPage: 2 | 4 | 6 | 8;
  showLogo: boolean;
}
export interface DrawSettingsView {
  /** whose settings: the class's own, the session's, or the defaults */
  from: 'class' | 'session' | 'defaults';
  settings: DrawSettings;
}
export interface DrawPlan {
  errors: string[];
  order: Array<{
    rank: number;
    ids: string[];
    numbers: string[];
    names: string[];
    outcome: 'offered' | 'waitlisted';
  }>;
  seats: number;
  seatsLeft: number;
  extraSeats: number;
  notDrawn: Array<{ numbers: string[]; names: string[] }>;
}
export interface DrawRecord {
  id: string;
  points: string;
  category: string | null;
  seats: number;
  offered: number;
  waitlisted: number;
  extraSeats: number;
  by: string | null;
  at: string;
}
