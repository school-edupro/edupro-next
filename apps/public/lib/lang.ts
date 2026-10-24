import { cookies } from 'next/headers';
import { LANG_COOKIE, type Lang } from './i18n';

/** The language the family chose (server side). */
export async function currentLang(): Promise<Lang> {
  try {
    return (await cookies()).get(LANG_COOKIE)?.value === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}
