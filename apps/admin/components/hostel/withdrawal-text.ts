/** Words used on the hostel withdrawal pages. */
export const HW_REASON: Record<string, string> = {
  parent_request: "Parent's request",
  discipline: 'Discipline',
  health: 'Health',
  other: 'Other',
};
export const HW_STATUS: Record<string, string> = {
  requested: 'In clearance',
  cleared: 'Ready to complete',
  completed: 'Left the hostel',
  cancelled: 'Cancelled',
};
export const HW_TONE: Record<string, 'warning' | 'info' | 'success' | 'neutral'> = {
  requested: 'warning',
  cleared: 'info',
  completed: 'success',
  cancelled: 'neutral',
};
export const dmy = (iso: string | null) =>
  iso ? iso.slice(0, 10).split('-').reverse().join('-') : '—';
export const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
