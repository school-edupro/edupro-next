/** Queue names shared by the API (producer through jobs_outbox) and the workers (consumers). */
export const QUEUES = {
  notifications: 'notifications', // SMS, WhatsApp, email, push deliveries
  exports: 'exports', // PDF, Excel, zip generation
  rfid: 'rfid', // device event batches to attendance
  reconciliation: 'reconciliation', // gateway settlements versus receipts
  maintenance: 'maintenance', // audit partitions, retention purges, cache refresh
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobEnvelope<T = unknown> {
  schoolId: string;
  requestId?: string;
  payload: T;
}
