import { apiFetch } from './api';

/**
 * A payroll set-up list (docs/design/86, "Set-up lists"): the API filters and pages it; the page shows the rows and
 * a bar with the filters, records per page, "Showing a – b of N", the pages and Excel / PDF of every filtered row.
 * A page with more than one list gives each a prefix, so their filters and pages live side by side in the address.
 */
export interface SetupListFilter {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'date';
  options?: Array<{ value: string; label: string }>;
}
export interface SetupList<R> {
  key: string;
  title: string;
  noun: string;
  filters: SetupListFilter[];
  applied: Record<string, string>;
  rows: R[];
  total: number;
  all: number;
  page: number;
  size: number;
  extra?: Record<string, unknown>;
}
export interface SetupListNav {
  key: string;
  prefix: string;
  /** this list's filter values, by their own names */
  values: Record<string, string>;
  /** the address's other params (tabs, the other lists'), kept by every link and form */
  keep: Array<[string, string]>;
  path: string;
  href: (page: number) => string;
  sizeHref: (size: string) => string;
  clearHref: string;
  files: { xlsx: string; pdf: string };
}

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Load a list for a page: `key` the list, `path` the page, `sp` its search params, `params` what the list needs (a
 * head's id, a kind), `prefix` when the page has more than one list (`v` → v_status, v_page).
 */
export async function setupList<R>(
  key: string,
  path: string,
  sp: Sp,
  opts: { params?: Record<string, string>; prefix?: string } = {},
): Promise<{ list: SetupList<R>; nav: SetupListNav }> {
  const prefix = opts.prefix ? `${opts.prefix}_` : '';
  const mine = (k: string) => (prefix ? k.startsWith(prefix) : !k.includes('_'));
  const entries = Object.entries(sp)
    .map(([k, raw]) => [k, one(raw)] as const)
    .filter(
      (e): e is readonly [string, string] =>
        e[1] !== undefined && e[1] !== '' && !['ok', 'error', 'detail', 'r'].includes(e[0]),
    );
  const own: Record<string, string> = {};
  for (const [k, v] of entries)
    if (mine(k) && /^[A-Za-z]{1,20}$/.test(k.slice(prefix.length)))
      own[k.slice(prefix.length)] = v.slice(0, 100);
  const api = new URLSearchParams({ ...own, ...(opts.params ?? {}) });
  const list = await apiFetch<SetupList<R>>(`/payroll/setup-lists/${key}?${api.toString()}`);
  // the list's own names: its filters, page and size; everything else in the address is kept as it is
  const names = new Set([...list.filters.map((f) => f.key), 'page', 'size']);
  const keep = entries.filter(([k]) => !(mine(k) && names.has(k.slice(prefix.length)))) as Array<
    [string, string]
  >;
  const values = { ...list.applied };
  const url = (change: Record<string, string>) => {
    const u = new URLSearchParams(keep);
    const merged: Record<string, string> = { ...values, size: String(list.size), ...change };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(`${prefix}${k}`, v);
    const q = u.toString();
    return `${path}${q ? `?${q}` : ''}`;
  };
  const file = (format: 'xlsx' | 'pdf') => {
    const u = new URLSearchParams({ kind: 'setuplist', key, format, save: '1' });
    for (const [k, v] of Object.entries({ ...values, ...(opts.params ?? {}) })) if (v) u.set(k, v);
    return `/api/payroll/pay-file?${u.toString()}`;
  };
  const clear = new URLSearchParams(keep).toString();
  return {
    list,
    nav: {
      key,
      prefix,
      values,
      keep,
      path,
      href: (page) => url({ page: String(page) }),
      sizeHref: (size) => url({ size, page: '1' }),
      clearHref: `${path}${clear ? `?${clear}` : ''}`,
      files: { xlsx: file('xlsx'), pdf: file('pdf') },
    },
  };
}
