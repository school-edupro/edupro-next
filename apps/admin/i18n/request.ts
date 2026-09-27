import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'edupro_locale';

/** Locale comes from a cookie set by the language switcher; no locale segment in the URL (S4-01). */
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = raw === 'hi' ? 'hi' : 'en';
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
