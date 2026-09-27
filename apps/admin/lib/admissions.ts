import type { BadgeTone } from '@edupro/ui';

/** Badge tone per application status (shared by the admissions list and detail pages). */
export const applicationTone = (s: string): BadgeTone =>
  s === 'selected' || s === 'admitted'
    ? 'success'
    : s === 'rejected' || s === 'withdrawn'
      ? 'danger'
      : s === 'shortlisted' || s === 'waitlisted'
        ? 'warning'
        : s === 'under_review'
          ? 'info'
          : 'neutral';
