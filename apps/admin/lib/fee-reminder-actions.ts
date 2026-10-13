'use server';
/**
 * Fee reminders to defaulters (the reminder screen calls these and gets a result back, as the
 * Communication compose screen does).
 */
import { ApiError, apiFetch } from './api';

export interface ReminderPayload {
  studentIds?: string[];
  asOf?: string;
  classId?: string;
  discountId?: string;
  minBalance?: number;
  ledger?: string;
  channels: Array<{ channel: 'sms' | 'whatsapp' | 'email'; templateId: string }>;
  to: 'father' | 'mother' | 'both' | 'contact';
  variables?: Record<string, string>;
  cc?: string[];
  again?: boolean;
}
export interface ReminderPreview {
  pupils: number;
  listed: number;
  totalDue: string;
  remindedToday: number;
  noContact: number;
  message: {
    total: number;
    skipped: number;
    byChannel: Record<string, { send: number; skipped: number; units: number; cost: number }>;
    needsApproval: boolean;
    askValues: string[];
    switchedOff: string[];
    quietHours: string | null;
    sample: Array<{ channel: string; name: string; address: string; student: string | null }>;
    rendered: Array<{ channel: string; subject: string | null; text: string; units: number }>;
  } | null;
}
export type ReminderResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(fn: () => Promise<T>): Promise<ReminderResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = (error.problem.errors as Array<{ message?: string }> | undefined) ?? [];
      return {
        ok: false,
        error:
          errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ') ||
          error.problem.detail ||
          error.problem.type,
      };
    }
    throw error;
  }
}
const post = <T>(path: string, p: unknown) =>
  call(() => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(p) }));

export async function reminderPreview(p: ReminderPayload) {
  return post<ReminderPreview>('/fees/reminders/preview', p);
}
export async function reminderTest(p: ReminderPayload) {
  return post<{ requestId: string; status: string; to: string[] }>('/fees/reminders/test', p);
}
export async function reminderSend(p: ReminderPayload) {
  return post<{
    requestId: string;
    status: string;
    pupils: number;
    parents: number;
    copies: number;
    totalDue: string;
    remindedToday: number;
    noContact: number;
  }>('/fees/reminders/send', p);
}
export async function reminderSaveCc(cc: string[]) {
  return call(() =>
    apiFetch<{ cc: string[] }>('/fees/reminders/cc', {
      method: 'PUT',
      body: JSON.stringify({ cc }),
    }),
  );
}
