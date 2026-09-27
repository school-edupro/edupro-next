import type { TenantContext } from './index';

/** Queue names shared by the API (producer through jobs_outbox) and the workers (consumers). */
export const QUEUES = {
  notifications: 'notifications', // SMS, WhatsApp, email, push deliveries
  exports: 'exports', // PDF, Excel, CSV generation
  rfid: 'rfid', // device event batches to attendance
  reconciliation: 'reconciliation', // gateway settlements versus receipts
  maintenance: 'maintenance', // audit partitions, retention purges, cache refresh
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Every job carries the tenant it belongs to and the request that produced it, so the worker runs it
 * under the same row-level security as the API call that enqueued it (ADR-002).
 */
export interface JobEnvelope<T = unknown> {
  schoolId: string;
  userId: string | null;
  requestId: string | null;
  /** Job kind inside the queue, for example "comms.message" or "export.generate". */
  kind: string;
  payload: T;
}

export function tenantForJob(
  envelope: JobEnvelope,
  academicYearId: string | null = null,
): TenantContext {
  return {
    schoolId: envelope.schoolId,
    userId: envelope.userId,
    allowedSchoolIds: [envelope.schoolId],
    academicYearId,
    requestId: envelope.requestId,
  };
}

export function isJobEnvelope(value: unknown): value is JobEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.schoolId === 'string' && typeof v.kind === 'string' && 'payload' in v;
}
