'use server';
/** Books sold (docs/design/36-library.md, "Library reports", part 4). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { SaleBook, SaleOrder } from './library-sales';

type Fail = { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const detail = (e: ApiError) => {
  const list = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return list?.length
    ? list.map((x) => `${x.path ? `${x.path}: ` : ''}${x.message ?? ''}`).join('; ')
    : String(e.problem.detail ?? e.problem.type);
};
const fail = (e: unknown): Fail => {
  if (e instanceof ApiError) return { ok: false, error: detail(e) };
  throw e;
};

/** A book scanned at the sale desk: can it be sold, its price as bought. */
export async function saleBook(accessionNo: string): Promise<{ ok: true; data: SaleBook } | Fail> {
  const no = accessionNo.trim();
  if (!no) return { ok: false, error: 'Scan or type the book number' };
  try {
    return {
      ok: true,
      data: await apiFetch<SaleBook>(
        `/library/sales/book?accessionNo=${encodeURIComponent(no.slice(0, 40))}`,
      ),
    };
  } catch (e) {
    return fail(e);
  }
}

/** One buyer's books sold. */
export async function sellBooks(input: {
  buyerKind: 'student' | 'employee' | 'other';
  buyerId?: string;
  buyerName?: string;
  buyerMobile?: string;
  books: Array<{ accessionNo: string; price: number }>;
  soldOn?: string;
  mode?: 'cash' | 'upi' | 'card' | 'bank';
  reference?: string;
  note?: string;
}): Promise<{ ok: true; data: SaleOrder } | Fail> {
  try {
    const data = await apiFetch<SaleOrder>('/library/sales', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/library/sales');
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/** A file of sales checked; its preview opens. */
export async function uploadSalesFile(fd: FormData) {
  const back = (d: string): never =>
    redirect(
      `/library/sales/upload?error=validation-failed&detail=${encodeURIComponent(d.slice(0, 600))}`,
    );
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) back('Choose an .xlsx or .csv file');
  const f = file as File;
  if (!/\.(xlsx|csv)$/i.test(f.name)) back('An .xlsx or .csv file, please');
  if (f.size > 5 * 1024 * 1024) back('The file is larger than 5 MB: split it');
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>(
      `/library/sales/uploads?fileName=${encodeURIComponent(f.name.slice(0, 200))}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(await f.arrayBuffer()),
      },
    );
    id = r.id;
  } catch (e) {
    if (e instanceof ApiError) back(detail(e));
    throw e;
  }
  redirect(`/library/sales/upload?id=${id}`);
}

/** The checked file applied (its good rows sold) or discarded. */
export async function decideSalesUpload(fd: FormData) {
  const id = pick(fd, 'uploadId');
  const apply = pick(fd, 'decision') === 'apply';
  if (!okId(id)) redirect('/library/sales/upload');
  let r: { counts?: { sales: number; ok: number; errors: number; amount: number } } = {};
  try {
    r = await apiFetch(`/library/sales/uploads/${id}/${apply ? 'apply' : 'discard'}`, {
      method: 'POST',
    });
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `/library/sales/upload?id=${id}&error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(detail(e).slice(0, 600))}`,
      );
    throw e;
  }
  revalidatePath('/library/sales');
  const c = r.counts;
  redirect(
    apply
      ? `/library/sales?ok=1&detail=${encodeURIComponent(`${String(c?.ok ?? 0)} books sold in ${String(c?.sales ?? 0)} sales from the file${c?.errors ? `; ${String(c.errors)} rows with a problem were left out` : ''}`)}`
      : `/library/sales/upload?ok=1&detail=${encodeURIComponent('The file is discarded: nothing was sold from it')}`,
  );
}
