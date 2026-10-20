import { API } from './api';

/** The school as its public pages show it (System → School profile). */
export interface SchoolProfile {
  code: string;
  name: string;
  subtitle: string | null;
  board: string | null;
  affiliationNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** the logo file's id, when the school has one (it also busts the browser's copy when changed) */
  logo: string | null;
}

/** The profile, kept for five minutes; null for an address that is not a school. */
export async function schoolProfile(code: string): Promise<SchoolProfile | null> {
  if (!/^[a-z0-9_-]{2,40}$/i.test(code)) return null;
  try {
    const res = await fetch(`${API}/api/v1/public/schools/${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });
    return res.ok ? ((await res.json()) as SchoolProfile) : null;
  } catch {
    return null;
  }
}
