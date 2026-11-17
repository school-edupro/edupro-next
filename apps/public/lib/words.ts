/** The two languages of the public pages, safe in the browser too (lib/api is server-only). */
export type Lang = 'en' | 'hi';
export const t = (lang: Lang, en: string, hi: string) => (lang === 'hi' ? hi : en);
export const langOf = (v: string | undefined): Lang => (v === 'hi' ? 'hi' : 'en');
