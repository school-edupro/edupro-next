'use server';
/** The book master (docs/design/36-library.md, part 2): saving titles and copies. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PickerSetup } from '@/components/FieldPicker';
import { ApiError, apiFetch } from './api';
import type { LabelCount } from './library-books';

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

// ---- part 3: the book list's Excel export with the fields picked ---------------------------------------

/** What the export picker shows; read when it opens. */
export async function loadBookExportSetup(): Promise<PickerSetup> {
  return apiFetch<PickerSetup>('/library/books/export/setup');
}

/** A named layout of the book list's export (the same name changes it). */
export async function saveBookLayout(input: {
  name: string;
  columns: string[];
  sheets: string[];
  level?: string;
}): Promise<{ ok: true; id: string; updated: boolean } | Fail> {
  try {
    const r = await apiFetch<{ id: string; updated: boolean }>('/library/books/export/layouts', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        columns: input.columns,
        level: input.level ?? 'copy',
      }),
    });
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

export async function deleteBookLayout(id: string): Promise<{ ok: true } | Fail> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/books/export/layouts/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

// ---- part 4: books from Excel ----------------------------------------------------------------------------

/** A file of books checked (nothing saved yet); its preview opens. */
export async function uploadBooks(fd: FormData) {
  const file = fd.get('file');
  const back = (detail: string) =>
    redirect(
      `/library/import?error=validation-failed&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  if (!(file instanceof File) || file.size === 0) back('Choose an .xlsx or .csv file');
  const f = file as File;
  if (!/\.(xlsx|csv)$/i.test(f.name)) back('An .xlsx or .csv file, please');
  if (f.size > 15 * 1024 * 1024) back('The file is larger than 15 MB: split it');
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>(
      `/library/imports?fileName=${encodeURIComponent(f.name.slice(0, 200))}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': /\.csv$/i.test(f.name)
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: Buffer.from(await f.arrayBuffer()),
      },
    );
    id = r.id;
  } catch (e) {
    back(problem(e).error);
  }
  redirect(`/library/import/${id}`);
}

/** The next batch of an upload imported; the page calls again until nothing is pending. */
export async function runImport(
  id: string,
): Promise<{ ok: true; status: string; pending: number; done: number; failed: number } | Fail> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    const r = await apiFetch<{ status: string; pending: number; done: number; failed: number }>(
      `/library/imports/${id}/run`,
      { method: 'POST' },
    );
    if (r.status === 'done') revalidatePath(`/library/import/${id}`);
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

export async function discardImport(fd: FormData) {
  const id = String(fd.get('id') ?? '');
  if (!okId(id)) redirect('/library/import');
  try {
    await apiFetch(`/library/imports/${id}/discard`, { method: 'POST' });
  } catch (e) {
    redirect(
      `/library/import/${id}?error=validation-failed&detail=${encodeURIComponent(problem(e).error.slice(0, 300))}`,
    );
  }
  revalidatePath('/library/import');
  redirect(
    `/library/import/${id}?ok=1&detail=${encodeURIComponent('Discarded: nothing was imported.')}`,
  );
}

// ---- part 5: labels -----------------------------------------------------------------------------------

/** How many labels and sheets the choice makes (nothing printed). */
export async function countLabels(
  input: Record<string, unknown>,
): Promise<({ ok: true } & LabelCount) | Fail> {
  try {
    const r = await apiFetch<LabelCount>('/library/labels', {
      method: 'POST',
      body: JSON.stringify({ ...input, dry: true }),
    });
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}
