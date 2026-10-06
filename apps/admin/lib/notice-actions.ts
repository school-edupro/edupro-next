'use server';
/** The notice compose screen's live count: how many students and employees the chosen audience reaches. */
import { ApiError, apiFetch } from './api';

export async function noticeReach(input: {
  kind: string;
  audience: string;
  targets: Array<{ type: string; id: string }>;
}): Promise<{ students: number; employees: number } | null> {
  try {
    return await apiFetch<{ students: number; employees: number }>('/academics/notices/reach', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}
