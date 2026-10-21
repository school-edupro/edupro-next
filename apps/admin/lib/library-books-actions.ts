'use server';
/** The book master (docs/design/36-library.md, part 2): saving titles and copies. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Fail = { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);

function problem(e: unknown): Fail {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
    return {
      ok: false,
      error: list?.length
        ? list.map((x) => `${x.path ? `${x.path}: ` : ''}${x.message ?? ''}`).join('; ')
        : String(e.problem.detail ?? e.problem.type),
    };
  }
  throw e;
}

/** A new title with its first copies, or a title changed. */
export async function saveBook(
  input: Record<string, unknown>,
  id?: string,
): Promise<{ ok: true; id: string; accessionNos: string[] } | Fail> {
  try {
    if (id) {
      if (!okId(id)) return { ok: false, error: 'Not found' };
      await apiFetch(`/library/books/${id}`, { method: 'PUT', body: JSON.stringify(input) });
      revalidatePath(`/library/books/${id}`);
      return { ok: true, id, accessionNos: [] };
    }
    const r = await apiFetch<{ id: string; accessionNos: string[] }>('/library/books', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/library');
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

export async function addCopies(
  id: string,
  input: Record<string, unknown>,
): Promise<{ ok: true; accessionNos: string[] } | Fail> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    const r = await apiFetch<{ accessionNos: string[] }>(`/library/books/${id}/copies`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/library/books/${id}`);
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

export async function editCopy(
  titleId: string,
  copyId: string,
  input: Record<string, unknown>,
): Promise<{ ok: true } | Fail> {
  if (!okId(copyId)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/copies/${copyId}`, { method: 'PUT', body: JSON.stringify(input) });
    revalidatePath(`/library/books/${titleId}`);
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

export async function changeCopyStatus(
  titleId: string,
  copyId: string,
  input: { status: string; on: string; reason: string; amount?: number },
): Promise<{ ok: true } | Fail> {
  if (!okId(copyId)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/copies/${copyId}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/library/books/${titleId}`);
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

/** Author or publisher names as one types. */
export async function suggestNames(kind: 'author' | 'publisher', q: string): Promise<string[]> {
  try {
    const r = await apiFetch<{ names: string[] }>(
      `/library/books/suggest?kind=${kind}&q=${encodeURIComponent(q.slice(0, 60))}`,
    );
    return r.names;
  } catch {
    return [];
  }
}

/** Titles already in the catalogue with this ISBN or title. */
export async function matchBooks(input: {
  isbn?: string;
  title?: string;
  except?: string;
}): Promise<
  Array<{
    id: string;
    title: string;
    author: string | null;
    year: number | null;
    edition: string | null;
    copies: number;
    by: string;
  }>
> {
  const p = new URLSearchParams();
  if (input.isbn) p.set('isbn', input.isbn.slice(0, 20));
  if (input.title) p.set('title', input.title.slice(0, 250));
  if (input.except && okId(input.except)) p.set('except', input.except);
  try {
    return (
      await apiFetch<{
        data: Array<{
          id: string;
          title: string;
          author: string | null;
          year: number | null;
          edition: string | null;
          copies: number;
          by: string;
        }>;
      }>(`/library/books/match?${p.toString()}`)
    ).data;
  } catch {
    return [];
  }
}
