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

// ---- part 6: periodical subscriptions -------------------------------------------------------------------

export async function saveSubscription(
  input: Record<string, unknown>,
  id?: string,
): Promise<{ ok: true; id: string } | Fail> {
  try {
    if (id) {
      if (!okId(id)) return { ok: false, error: 'Not found' };
      await apiFetch(`/library/subscriptions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      revalidatePath(`/library/periodicals/${id}`);
      return { ok: true, id };
    }
    const r = await apiFetch<{ id: string }>('/library/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/library/periodicals');
    return { ok: true, id: r.id };
  } catch (e) {
    return problem(e);
  }
}

/** The next period of a subscription; its page opens. */
export async function renewSubscription(fd: FormData) {
  const id = String(fd.get('id') ?? '');
  if (!okId(id)) redirect('/library/periodicals');
  let next = '';
  try {
    next = (
      await apiFetch<{ id: string }>(`/library/subscriptions/${id}/renew`, { method: 'POST' })
    ).id;
  } catch (e) {
    redirect(
      `/library/periodicals/${id}?error=validation-failed&detail=${encodeURIComponent(problem(e).error.slice(0, 300))}`,
    );
  }
  redirect(
    `/library/periodicals/${next}?ok=1&detail=${encodeURIComponent('Renewed for the next period.')}`,
  );
}

export async function cancelSubscription(
  id: string,
  input: { on: string; reason: string },
): Promise<{ ok: true } | Fail> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/subscriptions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/library/periodicals/${id}`);
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

export async function addSpecialIssue(
  id: string,
  input: { expectedOn: string; label: string },
): Promise<{ ok: true } | Fail> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/subscriptions/${id}/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/library/periodicals/${id}`);
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

/** An issue received, marked missing, or put back to expected. */
export async function markIssue(
  issueId: string,
  what: 'receive' | 'missing' | 'undo',
  input: Record<string, unknown> = {},
): Promise<{ ok: true } | Fail> {
  if (!okId(issueId)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`/library/issues/${issueId}/${what}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/library/periodicals', 'layout');
    return { ok: true };
  } catch (e) {
    return problem(e);
  }
}

export async function receiveIssues(
  ids: string[],
  on: string,
): Promise<{ ok: true; received: number } | Fail> {
  try {
    const r = await apiFetch<{ received: number }>('/library/issues/receive', {
      method: 'POST',
      body: JSON.stringify({ ids: ids.filter(okId), on }),
    });
    revalidatePath('/library/periodicals', 'layout');
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

/** Correcting accession numbers (part 2 of the register work): applied after the preview. */
export async function applyAccessionChange(fd: FormData) {
  const pick = (k: string) => String(fd.get(k) ?? '').trim();
  const input = {
    from: pick('from'),
    to: pick('to') || undefined,
    start: pick('start'),
    reason: pick('reason'),
  };
  const again = new URLSearchParams(
    Object.entries({ ...input, preview: '1' }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  let done: { changed: number; numbers: string[] };
  try {
    done = await apiFetch<{ changed: number; numbers: string[] }>('/library/accession/apply', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      again.set('error', e.problem.type);
      again.set('detail', String(e.problem.detail ?? '').slice(0, 600));
      redirect(`/library/accession?${again.toString()}`);
    }
    throw e;
  }
  revalidatePath('/library');
  const q = new URLSearchParams({
    ok: '1',
    detail: `Changed ${String(done.changed)} accession number${done.changed === 1 ? '' : 's'}. The old ${done.changed === 1 ? 'number is' : 'numbers are'} retired and still find the copies.`,
    // the new numbers run in order: their labels as a range
    lfrom: done.numbers[0] ?? '',
    lto: done.numbers[done.numbers.length - 1] ?? '',
  });
  redirect(`/library/accession?${q.toString()}`);
}

/** A book on loan reported lost, or returned damaged, and charged (part 3 of the register work). */
export async function chargeBook(fd: FormData) {
  const pick = (k: string) => String(fd.get(k) ?? '').trim();
  const kind = pick('kind') === 'damaged' ? 'damaged' : 'lost';
  const amount = Number(pick('amount'));
  const input = {
    accessionNo: pick('accessionNo'),
    kind,
    on: /^\d{4}-\d{2}-\d{2}$/.test(pick('on')) ? pick('on') : undefined,
    amount: pick('amount') !== '' && Number.isFinite(amount) ? amount : undefined,
    reason: pick('reason') || undefined,
    waiveFine: kind === 'damaged' ? fd.get('waiveFine') === 'on' : undefined,
  };
  let done: { amount: number; borrower: string; title: string };
  try {
    done = await apiFetch<{ amount: number; borrower: string; title: string }>('/library/charges', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      const q = new URLSearchParams({
        acc: input.accessionNo,
        kind,
        ...(input.on ? { on: input.on } : {}),
        error: e.problem.type,
        detail: String(e.problem.detail ?? '').slice(0, 600),
      });
      redirect(`/library/charges?${q.toString()}`);
    }
    throw e;
  }
  revalidatePath('/library/charges');
  const q = new URLSearchParams({
    ok: '1',
    detail: `${done.title}: ${done.borrower} is charged ₹${done.amount.toFixed(2)}. It is announced as a misc fee, paid at the fees counter.`,
  });
  redirect(`/library/charges?${q.toString()}`);
}
