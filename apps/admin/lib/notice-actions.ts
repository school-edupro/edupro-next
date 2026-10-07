'use server';
/** The notice compose screen's live count: how many students and employees the chosen audience reaches. */
import { ApiError, apiFetch } from './api';

export async function noticeReach(input: {
  kind: string;
  audience: string;
  targets: Array<{ type: string; id: string }>;
  departments?: string[];
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

export interface Person {
  value: string;
  label: string;
}

/** Students by name or admission number, for "only these students". */
export async function searchNoticeStudents(q: string): Promise<Person[]> {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  try {
    const r = await apiFetch<{
      data: Array<{
        id: string;
        displayName: string;
        admissionNo: string;
        classCode?: string | null;
        section?: string | null;
      }>;
    }>(`/people/students?size=12&status=active&q=${encodeURIComponent(term)}`);
    return r.data.map((s) => ({
      value: s.id,
      label: `${s.displayName}${s.classCode ? ` · ${s.classCode}${s.section ? `-${s.section}` : ''}` : ''} (${s.admissionNo})`,
    }));
  } catch (error) {
    if (error instanceof ApiError) return [];
    throw error;
  }
}

/** An Excel list of admission numbers or employee codes: the people found, and the numbers that were not. */
export async function noticeAudienceFile(
  kind: 'student' | 'employee',
  fileBase64: string,
): Promise<{ found: Person[]; missing: string[]; error?: string }> {
  try {
    const r = await apiFetch<{ found: Array<{ id: string; label: string }>; missing: string[] }>(
      '/academics/notices/audience-file',
      { method: 'POST', body: JSON.stringify({ kind, fileBase64 }) },
    );
    return { found: r.found.map((f) => ({ value: f.id, label: f.label })), missing: r.missing };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        found: [],
        missing: [],
        error:
          typeof error.problem.detail === 'string'
            ? error.problem.detail
            : 'Could not read the file',
      };
    throw error;
  }
}
