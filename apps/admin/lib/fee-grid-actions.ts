'use server';
/** Fee set-up grids (0103): class fee structure by month, discount by head, and their Excel uploads. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const amount = (fd: FormData, k: string) => {
  const n = Number(str(fd, k).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const back = (path: string, extra: string): never =>
  redirect(`${path}${path.includes('?') ? '&' : '?'}${extra}`);
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    back(path, `error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`);
  }
  throw error;
};
const file64 = async (fd: FormData, path: string): Promise<string> => {
  const f = fd.get('file');
  if (!(f instanceof File) || f.size === 0)
    back(path, `error=1&detail=${encodeURIComponent('Choose the Excel file first')}`);
  return Buffer.from(await (f as File).arrayBuffer()).toString('base64');
};
/** An upload saves all rows or none; the first wrong rows are told to the user. */
const uploaded = (
  path: string,
  out: { rows: number; saved: number; bad: Array<{ row: number; error: string }> },
): never =>
  out.bad.length > 0
    ? back(
        path,
        `error=1&detail=${encodeURIComponent(
          `Nothing was saved. ${out.bad
            .slice(0, 4)
            .map((b) => `Row ${b.row}: ${b.error}`)
            .join('; ')}${out.bad.length > 4 ? ` … and ${out.bad.length - 4} more` : ''}`.slice(
            0,
            400,
          ),
        )}`,
      )
    : back(path, `ok=1&uploaded=${out.saved}`);

const key = (fd: FormData) => ({
  classId: str(fd, 'classId'),
  feeGroup: str(fd, 'feeGroup') || 'general',
  studentType: str(fd, 'studentType') || 'all',
});
const structurePath = (k: ReturnType<typeof key>) =>
  `/fees/structures?classId=${k.classId}&group=${k.feeGroup}&studentType=${k.studentType}`;

export async function saveStructureGrid(fd: FormData) {
  const k = key(fd);
  const path = structurePath(k);
  const rows = fd
    .getAll('headIds')
    .map(String)
    .map((headId) => ({
      headId,
      amounts: Array.from({ length: 12 }, (_, i) => amount(fd, `a:${headId}:${i + 1}`)),
    }));
  try {
    await apiFetch('/fees/grids/structure', {
      method: 'PUT',
      body: JSON.stringify({ ...k, rows }),
    });
  } catch (error) {
    fail(path, error);
  }
  back(path, 'ok=1');
}

export async function cloneStructureGrid(fd: FormData) {
  const k = key(fd);
  const path = structurePath(k);
  const toClassIds = fd.getAll('toClassIds').map(String);
  if (toClassIds.length === 0)
    back(path, `error=1&detail=${encodeURIComponent('Tick at least one class to copy to')}`);
  try {
    await apiFetch('/fees/grids/structure/clone', {
      method: 'POST',
      body: JSON.stringify({ ...k, toClassIds }),
    });
  } catch (error) {
    fail(path, error);
  }
  back(path, 'ok=1');
}

export async function importStructureGrid(fd: FormData) {
  const k = key(fd);
  const path = structurePath(k);
  const fileBase64 = await file64(fd, path);
  let out = { rows: 0, saved: 0, bad: [] as Array<{ row: number; error: string }> };
  try {
    out = await apiFetch('/fees/grids/structure/import', {
      method: 'POST',
      body: JSON.stringify({ ...k, fileBase64 }),
    });
  } catch (error) {
    fail(path, error);
  }
  uploaded(path, out);
}

export async function saveDiscountLines(fd: FormData) {
  const id = str(fd, 'discountId');
  const path = `/fees/discounts?id=${id}`;
  const rows = fd
    .getAll('headIds')
    .map(String)
    .map((headId) => ({
      headId,
      percent: amount(fd, `p:${headId}`) || null,
      amount: amount(fd, `f:${headId}`) || null,
    }));
  try {
    await apiFetch(`/fees/grids/discount/${id}`, { method: 'PUT', body: JSON.stringify({ rows }) });
  } catch (error) {
    fail(path, error);
  }
  back(path, 'ok=1');
}

export async function importDiscountLines(fd: FormData) {
  const id = str(fd, 'discountId');
  const path = `/fees/discounts?id=${id}`;
  const fileBase64 = await file64(fd, path);
  let out = { rows: 0, saved: 0, bad: [] as Array<{ row: number; error: string }> };
  try {
    out = await apiFetch(`/fees/grids/discount/${id}/import`, {
      method: 'POST',
      body: JSON.stringify({ fileBase64 }),
    });
  } catch (error) {
    fail(path, error);
  }
  uploaded(path, out);
}

export async function importClassCalendar(fd: FormData) {
  const classId = str(fd, 'classId');
  const path = `/fees/rules?classId=${classId}`;
  const fileBase64 = await file64(fd, path);
  let out = { rows: 0, saved: 0, bad: [] as Array<{ row: number; error: string }> };
  try {
    out = await apiFetch('/fees/grids/calendar/import', {
      method: 'POST',
      body: JSON.stringify({ classId, fileBase64 }),
    });
  } catch (error) {
    fail(path, error);
  }
  uploaded(path, out);
}

/** The twelve months of the working year, once, so the grids have their columns. */
export async function createFeeMonths(fd: FormData) {
  const path = str(fd, 'back') || '/fees/rules';
  try {
    await apiFetch('/fees/periods/generate', {
      method: 'POST',
      body: JSON.stringify({ dueDay: 10, monthsPerInstalment: 3 }),
    });
  } catch (error) {
    fail(path, error);
  }
  back(path, 'ok=1');
}
