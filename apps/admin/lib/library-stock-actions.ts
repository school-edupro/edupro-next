'use server';
/** Stock verification in cycles (docs/design/36-library.md, "Library reports", part 3). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { StockVerifyResult } from './library-stock';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const ids = (fd: FormData, k: string) =>
  fd
    .getAll(k)
    .map((x) => String(x))
    .filter(okId);
const detail = (e: ApiError) => {
  const list = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return list?.length
    ? list.map((x) => `${x.path ? `${x.path}: ` : ''}${x.message ?? ''}`).join('; ')
    : String(e.problem.detail ?? e.problem.type);
};
function go(path: string, q: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(q).toString()}`);
}
/** Back to the cycle's page, keeping its list's place (only that page). */
function back(fd: FormData, id: string, q: Record<string, string>): never {
  const from = pick(fd, 'back');
  const base = new RegExp(`^/library/stock/${id}(\\?[^#]*)?$`).test(from)
    ? from
    : `/library/stock/${id}`;
  const u = new URL(base, 'http://x');
  for (const k of ['ok', 'error', 'detail', 'upload']) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  redirect(`${u.pathname}?${u.searchParams.toString()}`);
}

/** A new cycle over the libraries, shelves and material types ticked (none ticked: all). */
export async function createStockCycle(fd: FormData) {
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>('/library/stock/cycles', {
      method: 'POST',
      body: JSON.stringify({
        name: pick(fd, 'name'),
        libraryIds: ids(fd, 'libraryIds'),
        shelfIds: ids(fd, 'shelfIds'),
        materialTypeIds: ids(fd, 'materialTypeIds'),
        note: pick(fd, 'note') || undefined,
      }),
    });
    id = r.id;
  } catch (e) {
    if (e instanceof ApiError)
      go('/library/stock', { new: '1', error: e.problem.type, detail: detail(e).slice(0, 600) });
    throw e;
  }
  revalidatePath('/library/stock');
  redirect(
    `/library/stock/${id}?ok=1&detail=${encodeURIComponent('The cycle is open: scan the books or upload a file of book numbers')}`,
  );
}

/** Numbers scanned or pasted at the shelves; the page shows what each was. */
export async function verifyStockNumbers(
  cycleId: string,
  numbers: string[],
): Promise<{ ok: true; data: StockVerifyResult } | { ok: false; error: string }> {
  if (!okId(cycleId)) return { ok: false, error: 'Cycle not found' };
  const list = numbers.map((x) => x.trim()).filter(Boolean);
  if (!list.length) return { ok: false, error: 'Scan or type a book number' };
  try {
    const data = await apiFetch<StockVerifyResult>(`/library/stock/cycles/${cycleId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ accessionNos: list.slice(0, 5000) }),
    });
    revalidatePath(`/library/stock/${cycleId}`);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detail(e) };
    throw e;
  }
}

/** A file of book numbers checked against the cycle; its preview opens on the page. */
export async function uploadStockFile(fd: FormData) {
  const id = pick(fd, 'cycleId');
  if (!okId(id)) redirect('/library/stock');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0)
    back(fd, id, { error: 'validation-failed', detail: 'Choose an .xlsx, .csv or .txt file' });
  const f = file as File;
  if (!/\.(xlsx|csv|txt)$/i.test(f.name))
    back(fd, id, { error: 'validation-failed', detail: 'An .xlsx, .csv or .txt file, please' });
  if (f.size > 5 * 1024 * 1024)
    back(fd, id, { error: 'validation-failed', detail: 'The file is larger than 5 MB: split it' });
  let upload = '';
  try {
    const r = await apiFetch<{ id: string }>(
      `/library/stock/cycles/${id}/uploads?fileName=${encodeURIComponent(f.name.slice(0, 200))}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(await f.arrayBuffer()),
      },
    );
    upload = r.id;
  } catch (e) {
    if (e instanceof ApiError)
      back(fd, id, { error: e.problem.type, detail: detail(e).slice(0, 600) });
    throw e;
  }
  back(fd, id, { upload });
}

/** The checked file applied (its copies verified) or discarded. */
export async function decideStockUpload(fd: FormData) {
  const id = pick(fd, 'cycleId');
  const upload = pick(fd, 'uploadId');
  const apply = pick(fd, 'decision') === 'apply';
  if (!okId(id) || !okId(upload)) redirect('/library/stock');
  let r: { counts?: Record<string, number> } = {};
  try {
    r = await apiFetch<{ counts?: Record<string, number> }>(
      `/library/stock/uploads/${upload}/${apply ? 'apply' : 'discard'}`,
      { method: 'POST' },
    );
  } catch (e) {
    if (e instanceof ApiError)
      back(fd, id, { error: e.problem.type, detail: detail(e).slice(0, 600) });
    throw e;
  }
  revalidatePath(`/library/stock/${id}`);
  back(fd, id, {
    ok: '1',
    detail: apply
      ? `${String(r.counts?.verify ?? 0)} copies verified from the file; ${String((r.counts?.outside ?? 0) + (r.counts?.unknown ?? 0))} numbers kept as not in the cycle`
      : 'The file is discarded: nothing was verified from it',
  });
}

/** One copy verified by hand, or taken back to pending. */
export async function markStockItem(fd: FormData) {
  const id = pick(fd, 'cycleId');
  const copy = pick(fd, 'copyId');
  const found = pick(fd, 'to') === 'verified';
  if (!okId(id) || !okId(copy)) redirect('/library/stock');
  try {
    await apiFetch(`/library/stock/cycles/${id}/items/${copy}/${found ? 'verify' : 'unverify'}`, {
      method: 'POST',
      body: JSON.stringify(found ? { remark: pick(fd, 'remark') || undefined } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError)
      back(fd, id, { error: e.problem.type, detail: detail(e).slice(0, 600) });
    throw e;
  }
  revalidatePath(`/library/stock/${id}`);
  back(fd, id, {
    ok: '1',
    detail: `${pick(fd, 'accessionNo')} ${found ? 'verified by hand' : 'is pending again'}`,
  });
}

/** The cycle closed (the copies not found missing; lost if ticked), or cancelled with a reason. */
export async function endStockCycle(fd: FormData) {
  const id = pick(fd, 'cycleId');
  const cancel = pick(fd, 'end') === 'cancel';
  if (!okId(id)) redirect('/library/stock');
  try {
    await apiFetch(`/library/stock/cycles/${id}/${cancel ? 'cancel' : 'close'}`, {
      method: 'POST',
      body: JSON.stringify(
        cancel
          ? { reason: pick(fd, 'reason') }
          : {
              markMissingLost: fd.get('markMissingLost') === 'on',
              note: pick(fd, 'note') || undefined,
            },
      ),
    });
  } catch (e) {
    if (e instanceof ApiError)
      back(fd, id, { error: e.problem.type, detail: detail(e).slice(0, 600) });
    throw e;
  }
  revalidatePath('/library/stock');
  revalidatePath(`/library/stock/${id}`);
  redirect(
    `/library/stock/${id}?ok=1&detail=${encodeURIComponent(cancel ? 'The cycle is cancelled' : 'The cycle is closed')}`,
  );
}
