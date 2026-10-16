/** Words used on the hostel withdrawal pages. */
export const HW_REASON: Record<string, string> = {
  parent_request: "Parent's request",
  discipline: 'Discipline',
  health: 'Health',
  other: 'Other',
};
export const HW_STATUS: Record<string, string> = {
  requested: 'Waiting for approval',
  cleared: 'Approved, to complete',
  completed: 'Left the hostel',
  cancelled: 'Cancelled',
  rejected: 'Not approved',
};
export const HW_TONE: Record<string, 'warning' | 'info' | 'success' | 'neutral' | 'danger'> = {
  requested: 'warning',
  cleared: 'info',
  completed: 'success',
  cancelled: 'neutral',
  rejected: 'danger',
};
export const dmy = (iso: string | null) =>
  iso ? iso.slice(0, 10).split('-').reverse().join('-') : '—';
export const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
