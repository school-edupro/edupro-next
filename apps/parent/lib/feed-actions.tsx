'use server';
/**
 * The family website's lists that load as they scroll (Health, Notices, Session plan and date sheets, Messages): the
 * next page of 10, drawn on the server with the same cards as the first.
 */
import { DocItems, type FamilyDoc } from '@/app/(app)/documents/DocItems';
import { HealthItems, type HealthItem } from '@/app/(app)/health/HealthItems';
import type { InboxItem } from '@/app/(app)/messages/MessageItem';
import { MessageItems } from '@/app/(app)/messages/MessageItems';
import { NoticeItems } from '@/app/(app)/notices/NoticeItems';
import type { Notice } from '@/app/(app)/notices/shared';
import type { FeedPage } from '@/components/MoreFeed';
import { bff } from './bff';
import { currentLang } from './i18n';

/** How many a page of these lists brings: the latest 10, then 10 more as the person scrolls. */
const PAGE = 10;

/** The list's filters as the API takes them: only known keys, plain short values. */
function filterQuery(filters: Record<string, string>, keys: readonly string[]): string | null {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (!keys.includes(k)) return null;
    if (typeof v !== 'string' || v.length > 80) return null;
    if (v) out.set(k, v);
  }
  return out.toString();
}

const okPage = (page: number) => Number.isInteger(page) && page >= 2 && page <= 500;

/** The next page of the child's clinic visits and health cards. */
export async function healthPage(filters: Record<string, string>, page: number): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['kind', 'q', 'from', 'to', 'studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: HealthItem[]; page: { total: number } }>(
      `/clinic/mine/list?${qs}&page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    return {
      ok: true,
      node: <HealthItems items={r.data} lang={lang} />,
      more: page * PAGE < r.page.total,
    };
  } catch {
    return { ok: false };
  }
}

/** The next page of the child's notices and circulars (the type, the words, the dates). */
export async function noticesPage(
  filters: Record<string, string>,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['kind', 'q', 'from', 'to', 'studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: Notice[]; page: { total: number } }>(
      `/academics/notices?${qs}&page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    const kid = filters.studentId ? { id: filters.studentId } : null;
    return {
      ok: true,
      node: <NoticeItems items={r.data} lang={lang} kid={kid} />,
      more: page * PAGE < r.page.total,
    };
  } catch {
    return { ok: false };
  }
}

/** The next page of the papers shared with the child's class and by the school (a kind). */
export async function documentsPage(
  filters: Record<string, string>,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['kind', 'studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: FamilyDoc[]; page: { total: number } }>(
      `/academics/documents?${qs}&page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    const kid = filters.studentId ? { id: filters.studentId } : null;
    return {
      ok: true,
      node: <DocItems items={r.data} lang={lang} kid={kid} />,
      more: page * PAGE < r.page.total,
    };
  } catch {
    return { ok: false };
  }
}

/** The next page of the messages (one child's, when the family has several). */
export async function messagesPage(
  filters: Record<string, string>,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: InboxItem[]; page: { more: boolean } }>(
      `/comms/inbox?${qs ? `${qs}&` : ''}page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    return { ok: true, node: <MessageItems items={r.data} lang={lang} />, more: r.page.more };
  } catch {
    return { ok: false };
  }
}
