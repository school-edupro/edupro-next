/** Shared bits of the mess pages (0161). */
import { apiFetch } from './api';

export interface MessHostel {
  id: string;
  name: string;
}
export interface Week {
  weekOf: string;
  hostel: MessHostel;
  cycleWeeks: number;
  cycleStart: string;
  cycleWeek: number;
  meals: Array<{ id: string; name: string; atTime: string }>;
  days: Array<{
    date: string;
    weekday: number;
    meals: Array<{
      mealId: string;
      meal: string;
      atTime: string;
      items: string | null;
      weekly: string | null;
      changed: boolean;
      note: string | null;
    }>;
  }>;
}
export interface Template {
  hostel: MessHostel;
  cycleWeeks: number;
  cycleStart: string;
  week: number;
  thisWeek: number;
  meals: Array<{ id: string; name: string; atTime: string }>;
  days: Array<{ weekday: number; day: string; items: string[] }>;
}
export interface DietLists {
  types: Array<{
    id: string;
    code: string;
    name: string;
    active: boolean;
    isDefault: boolean;
    used: number;
  }>;
  allergies: Array<{ id: string; name: string; active: boolean; used: number }>;
}

export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const shift = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (iso: string) =>
  shift(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
export const dayName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
export const isDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

/** The hostels the person sees, and the one asked for (the first when none). */
export async function messHostels(asked?: string) {
  const hostels = (await apiFetch<{ data: MessHostel[] }>('/hostel/hostels')).data;
  return { hostels, hostel: hostels.find((h) => h.id === asked) ?? hostels[0] };
}

/** A link to a mess file through the admin route. */
export const messFile = (
  kind: string,
  params: Record<string, string | undefined>,
  format?: string,
) =>
  `/api/hostel/mess-file?${new URLSearchParams({
    kind,
    ...(format ? { format } : {}),
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v) as Array<[string, string]>),
  }).toString()}`;
