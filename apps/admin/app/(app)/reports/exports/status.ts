import type { ExportRow } from '@/lib/types';

/** An export's state in words (the export centre and a file's page). */
export const EXPORT_STATUS: Record<ExportRow['status'], string> = {
  queued: 'Waiting to be made',
  running: 'Being made',
  ready: 'Ready',
  failed: 'Could not be made',
  expired: 'Cleared after 7 days',
};

export const EXPORT_TONE: Record<
  ExportRow['status'],
  'neutral' | 'info' | 'success' | 'danger' | 'warning'
> = {
  queued: 'info',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};
