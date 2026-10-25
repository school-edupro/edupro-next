import { API } from './api';
import { admissionFetch } from './admission';

/** The family's questions to the school (docs/design/43, part 4). */
export interface QueryRow {
  id: string;
  number: string;
  subject: string;
  head: string;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  openedAt: string;
  closedAt: string | null;
  lastAnswerAt: string | null;
  unread: boolean;
  registration: { number: string | null; candidate: string | null; className: string | null };
}

export interface QueryDetail extends Omit<QueryRow, 'unread' | 'lastAnswerAt' | 'registration'> {
  registration: QueryRow['registration'] & { id: string | null };
  body: string;
  fileIds: string[];
  resolution: string | null;
  rating: number | null;
  ratingComment: string | null;
  replies: Array<{
    id: string;
    fromFamily: boolean;
    author: string | null;
    body: string;
    fileIds: string[];
    at: string;
  }>;
  you: { canReply: boolean; canReopen: boolean; canRate: boolean; reopenUntil: string | null };
}

export interface QueryOptions {
  heads: Array<{ code: string; name: string }>;
  registrations: Array<{
    id: string;
    number: string | null;
    candidate: string | null;
    className: string;
  }>;
}

/** How a question stands, in the family's words. */
export const QUERY_STATUS: Record<
  QueryRow['status'],
  { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' }
> = {
  open: { label: 'Sent', tone: 'warning' },
  in_progress: { label: 'Being looked at', tone: 'info' },
  answered: { label: 'Answered', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/** A file for a question: a slot owned by the registration, then the bytes (server side). */
export async function uploadQueryFile(applicationId: string, file: File): Promise<string> {
  const slot = await admissionFetch<{
    file: { id: string };
    upload: { url: string; method?: string; headers?: Record<string, string> };
  }>('/me/files/slot', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      fieldKey: 'query_file',
      fileName: file.name.slice(0, 200) || 'file',
      contentType: file.type,
      sizeBytes: file.size,
    }),
  });
  const target = slot.upload.url.startsWith('http') ? slot.upload.url : `${API}${slot.upload.url}`;
  const headers = new Headers({ 'content-type': file.type });
  for (const [k, v] of Object.entries(slot.upload.headers ?? {})) headers.set(k, v);
  const put = await fetch(target, {
    method: slot.upload.method || 'PUT',
    headers,
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!put.ok) throw new Error(`${file.name} did not upload; try again`);
  return slot.file.id;
}
