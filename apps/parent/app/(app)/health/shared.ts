/** What the Health screens of the parent app share: shapes and labels. */
export type Outcome = 'back_to_class' | 'rest' | 'sent_home' | 'referred';
export interface Visit {
  id: string;
  number: string;
  studentId: string | null;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
  inAt: string;
  outAt: string | null;
  complaint: string;
  diseases: string[];
  temperatureC: number | null;
  pulse: number | null;
  bp: string | null;
  spo2: number | null;
  weightKg: number | null;
  diagnosis: string | null;
  treatment: string | null;
  prescription: string | null;
  remark: string | null;
  outcome: Outcome;
  referredTo: string | null;
  clinic: string | null;
  doctor: string | null;
  nurse: string | null;
  medicines: Array<{
    id: string;
    name: string;
    strength: string | null;
    unit: string;
    qty: number;
    dosage: string | null;
  }>;
}
export interface HealthCard {
  id: string;
  camp: string;
  studentId: string;
  student: string;
  section: string | null;
  admissionNo: string | null;
  examDate: string;
  place: string | null;
  doctor: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bloodGroup: string | null;
  remarks: string | null;
  needsAttention: boolean;
}
export const OUTCOME: Record<Outcome, [string, 'success' | 'info' | 'warning' | 'danger']> = {
  back_to_class: ['Back to class', 'success'],
  rest: ['Resting in the clinic', 'info'],
  sent_home: ['Sent home', 'warning'],
  referred: ['Referred', 'danger'],
};
const IST = 'Asia/Kolkata';
export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });
/** 05 / Oct Mon for the date block of a card. */
export const dateParts = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T06:30:00Z` : iso);
  return {
    day: d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit' }),
    month: d.toLocaleDateString('en-IN', { timeZone: IST, month: 'short', year: '2-digit' }),
  };
};
export const medName = (m: { name: string; strength: string | null }) =>
  `${m.name}${m.strength ? ` ${m.strength}` : ''}`;
