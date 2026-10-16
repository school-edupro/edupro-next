'use server';
/** The rebuilt hostel mess (0161): meals, the menu cycle, meal attendance, diets and their set-up. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/hostel/mess';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs
        .map((e) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`)
        .filter(Boolean)
        .join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
const join = (path: string, q: string) => `${path}${path.includes('?') ? '&' : '?'}${q}`;
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      join(
        path,
        `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((detailOf(error) || error.problem.type).slice(0, 300))}`,
      ),
    );
  throw error;
}
/** Back to the mess page the form came from (never elsewhere). */
const here = (fd: FormData) => {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : BASE;
};
const done = (path: string, detail: string): never => {
  revalidatePath(BASE);
  // a fresh message replaces the last one
  const clean = path.replace(/[?&](ok|error|detail)=[^&]*/g, '').replace(/^([^?]*)&/, '$1?');
  redirect(join(clean, `ok=1&detail=${encodeURIComponent(detail.slice(0, 400))}`));
};
const call = async (to: string, path: string, method: string, body?: unknown) => {
  try {
    return await apiFetch<Record<string, unknown>>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    back(to, error);
  }
};

// ---- meals of the school ----------------------------------------------------------------------------------
/** A meal with the hostels ticked (h-<hostelId>) and a hostel's own time (t-<hostelId>, empty = the meal's). */
export async function saveMessMeal(fd: FormData) {
  const to = here(fd);
  const id = str(fd, 'id');
  const hostels = fd
    .getAll('hostel')
    .map(String)
    .filter((h) => /^\d{1,18}$/.test(h))
    .map((h) => ({ hostelId: h, atTime: str(fd, `t-${h}`) || null }));
  await call(to, id ? `/hostel/mess/meals/${id}` : '/hostel/mess/meals', id ? 'PUT' : 'POST', {
    name: str(fd, 'name'),
    atTime: str(fd, 'atTime'),
    active: id ? fd.get('active') === 'on' : true,
    hostels,
  });
  done(to, id ? 'Meal saved.' : 'Meal added.');
}

export async function deleteMessMeal(fd: FormData) {
  const to = here(fd);
  await call(to, `/hostel/mess/meals/${str(fd, 'id')}`, 'DELETE');
  done(to, 'Meal deleted.');
}

/** The meals in a new order (ids, comma separated). */
export async function orderMessMeals(fd: FormData) {
  const to = here(fd);
  await call(to, '/hostel/mess/meals/order', 'PUT', {
    ids: str(fd, 'ids').split(',').filter(Boolean),
  });
  done(to, 'Order saved.');
}

// ---- the menu cycle ----------------------------------------------------------------------------------------
export async function saveMenuCycle(fd: FormData) {
  const to = here(fd);
  await call(to, '/hostel/menu/cycle', 'PUT', {
    hostelId: str(fd, 'hostelId'),
    weeks: Number(str(fd, 'weeks')),
    start: str(fd, 'start'),
  });
  done(to, 'The menu cycle is saved.');
}

/** One week of the cycle: a cell per meal and weekday (m-<mealId>-<weekday>). */
export async function saveMenuGrid(fd: FormData) {
  const to = here(fd);
  const entries: Array<{ mealId: string; weekday: number; items: string }> = [];
  for (const [k, v] of fd.entries()) {
    const m = /^m-(\d{1,18})-([0-6])$/.exec(k);
    if (m) entries.push({ mealId: m[1]!, weekday: Number(m[2]), items: String(v).trim() });
  }
  await call(to, '/hostel/menu', 'PUT', {
    hostelId: str(fd, 'hostelId'),
    cycleWeek: Number(str(fd, 'cycleWeek') || '1'),
    entries,
  });
  done(to, 'Menu saved.');
}

/** A day to other days (to = "<week>-<weekday>"), or a cycle week to other weeks (to = "<week>"). */
export async function copyMenu(fd: FormData) {
  const to = here(fd);
  const fromWeekday = str(fd, 'fromWeekday');
  const targets = fd
    .getAll('to')
    .map(String)
    .map((t) => {
      const [w, d] = t.split('-');
      return { week: Number(w), weekday: d === undefined ? null : Number(d) };
    });
  if (!targets.length)
    back(to, new ApiError(400, { type: 'validation-failed', detail: 'Tick where to copy to' }));
  const r = await call(to, '/hostel/menu/copy', 'POST', {
    hostelId: str(fd, 'hostelId'),
    fromWeek: Number(str(fd, 'fromWeek')),
    fromWeekday: fromWeekday === '' ? null : Number(fromWeekday),
    to: targets,
  });
  done(to, `Copied (${String(r?.copied ?? 0)} cell(s)).`);
}

export async function cloneMenu(fd: FormData) {
  const to = here(fd);
  const toHostelIds = fd.getAll('toHostel').map(String);
  if (!toHostelIds.length)
    back(
      to,
      new ApiError(400, { type: 'validation-failed', detail: 'Tick the hostels to copy to' }),
    );
  const r = await call(to, '/hostel/menu/clone', 'POST', {
    fromHostelId: str(fd, 'hostelId'),
    toHostelIds,
    mode: str(fd, 'mode') === 'fill' ? 'fill' : 'replace',
  });
  const missing = (r?.missing as string[] | undefined) ?? [];
  done(
    to,
    `Menu copied (${String(r?.copied ?? 0)} cell(s)).${missing.length ? ` Not served there, so left out: ${missing.join(', ')}.` : ''}`,
  );
}

// ---- meal attendance -----------------------------------------------------------------------------------------
/** Who skipped a meal (skip = studentId, reason-<studentId>); everyone else not away had it. */
export async function saveMealAttendance(fd: FormData) {
  const to = here(fd);
  const skips = fd
    .getAll('skip')
    .map(String)
    .filter((s) => /^\d{1,18}$/.test(s))
    .map((s) => ({ studentId: s, reason: str(fd, `reason-${s}`) }));
  const r = await call(to, '/hostel/meal-roll', 'POST', {
    mealId: str(fd, 'mealId'),
    on: str(fd, 'on'),
    skips,
  });
  done(
    to,
    `Saved: ${String(r?.served ?? 0)} had the meal, ${String(r?.skipped ?? 0)} skipped, ${String(r?.away ?? 0)} away.`,
  );
}

// ---- diets -------------------------------------------------------------------------------------------------
export async function saveDiet(fd: FormData) {
  const to = here(fd);
  await call(to, `/hostel/diets/${str(fd, 'studentId')}`, 'PUT', {
    diet: str(fd, 'diet'),
    noOnionGarlic: fd.get('noOnionGarlic') === 'on',
    allergies: fd.getAll('allergy').map(String),
    notes: str(fd, 'notes'),
  });
  done(to.replace(/[?&]edit=\d+/, ''), 'Diet saved.');
}

export async function clearDiet(fd: FormData) {
  const to = here(fd);
  await call(to, `/hostel/diets/${str(fd, 'studentId')}`, 'DELETE');
  done(to.replace(/[?&]edit=\d+/, ''), 'Back to the school’s default diet.');
}

export async function uploadDiets(fd: FormData) {
  const to = here(fd);
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size)
    back(to, new ApiError(400, { type: 'validation-failed', detail: 'Choose the Excel file' }));
  const f = file as File;
  if (f.size > 2_000_000)
    back(
      to,
      new ApiError(400, { type: 'validation-failed', detail: 'The file is larger than 2 MB' }),
    );
  const r = await call(to, '/hostel/diets/upload', 'POST', {
    fileBase64: Buffer.from(await f.arrayBuffer()).toString('base64'),
  });
  const errors = (r?.errors as Array<{ row: number; message: string }> | undefined) ?? [];
  if (errors.length)
    back(
      to,
      new ApiError(422, {
        type: 'validation-failed',
        detail: `Nothing was saved. ${errors
          .slice(0, 6)
          .map((e) => `Row ${String(e.row)}: ${e.message}`)
          .join('; ')}${errors.length > 6 ? ` (and ${String(errors.length - 6)} more)` : ''}`,
      }),
    );
  done(to, `${String(r?.saved ?? 0)} diet(s) saved from the sheet.`);
}

/**
 * Diet types (t-<i>-id/code/name/active, default = i, remove-t-<i>) and allergies (a-<i>-id/name/active,
 * remove-a-<i>), each with one new row (index "new").
 */
export async function saveDietTypes(fd: FormData) {
  const to = here(fd);
  const idx = (prefix: string) => [
    ...new Set(
      [...fd.keys()]
        .map((k) => new RegExp(`^${prefix}-(\\d+|new)-name$`).exec(k)?.[1])
        .filter((x): x is string => !!x),
    ),
  ];
  const types = idx('t')
    .filter((i) => fd.get(`remove-t-${i}`) !== 'on' && str(fd, `t-${i}-name`))
    .map((i) => ({
      id: str(fd, `t-${i}-id`) || undefined,
      code:
        str(fd, `t-${i}-code`) ||
        str(fd, `t-${i}-name`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/^(\d)/, 'd$1')
          .slice(0, 30),
      name: str(fd, `t-${i}-name`),
      active: i === 'new' || fd.get(`t-${i}-active`) === 'on',
      isDefault: str(fd, 'default') === i,
    }));
  const allergies = idx('a')
    .filter((i) => fd.get(`remove-a-${i}`) !== 'on' && str(fd, `a-${i}-name`))
    .map((i) => ({
      id: str(fd, `a-${i}-id`) || undefined,
      name: str(fd, `a-${i}-name`),
      active: i === 'new' || fd.get(`a-${i}-active`) === 'on',
    }));
  await call(to, '/hostel/mess/diet-types', 'PUT', { types, allergies });
  done(to, 'Diet types and allergies saved.');
}
