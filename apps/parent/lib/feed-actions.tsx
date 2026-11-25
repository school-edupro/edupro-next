'use server';
/**
 * The family website's lists that load as they scroll (Health, Notices, Session plan and date sheets, Messages,
 * Queries, Gate passes, the Library's history and catalogue): the next page of 10, drawn on the server with the same
 * cards as the first.
 */
import { DocItems, type FamilyDoc } from '@/app/(app)/documents/DocItems';
import { PassItems } from '@/app/(app)/gate-passes/PassItems';
import type { Pass } from '@/app/(app)/gate-passes/shared';
import { HealthItems, type HealthItem } from '@/app/(app)/health/HealthItems';
import type { InboxItem } from '@/app/(app)/messages/MessageItem';
import { MessageItems } from '@/app/(app)/messages/MessageItems';
import { NoticeItems } from '@/app/(app)/notices/NoticeItems';
import { QueryItems, type Query } from '@/app/(app)/queries/QueryItems';
import { BookItems, type Title } from '@/app/(app)/library/BookItems';
import {
  HistoryRows,
  historyFilters,
  historyQuery,
  type HistoryFilters,
  type LibraryHistory,
} from '@/components/MyLibrary';
import { familyKids } from './child';
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

/** The next page of the family's queries, complaints and leave requests (latest first). */
export async function queriesPage(
  filters: Record<string, string>,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['status', 'kind', 'q', 'studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: Query[]; page: { total: number } }>(
      `/engagement/mine/queries?${qs ? `${qs}&` : ''}order=latest&page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    return {
      ok: true,
      node: <QueryItems items={r.data} lang={lang} />,
      more: page * PAGE < r.page.total,
    };
  } catch {
    return { ok: false };
  }
}

/** The next page of the child's gate passes (the list; a month is shown whole). */
export async function passesPage(filters: Record<string, string>, page: number): Promise<FeedPage> {
  if (!okPage(page)) return { ok: false };
  const qs = filterQuery(filters, ['state', 'q', 'studentId']);
  if (qs === null) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: Pass[]; page: { total: number } }>(
      `/gate-passes/mine?${qs ? `${qs}&` : ''}page=${String(page)}&size=${String(PAGE)}`,
    );
    const lang = await currentLang();
    return {
      ok: true,
      node: <PassItems items={r.data} lang={lang} />,
      more: page * PAGE < r.page.total,
    };
  } catch {
    return { ok: false };
  }
}

const ID = /^\d{1,18}$/;

/** The next page of a child's library history (the filters checked again). */
export async function libraryHistoryPage(
  kidId: string,
  filters: HistoryFilters,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page) || !ID.test(kidId)) return { ok: false };
  const f = historyFilters(filters);
  try {
    const r = await bff.api.fetch<LibraryHistory>(
      `/library/portal/borrowers/student/${kidId}/history?${historyQuery(f, page, PAGE)}`,
    );
    const lang = await currentLang();
    return { ok: true, node: <HistoryRows rows={r.rows} lang={lang} />, more: page < r.pages };
  } catch {
    return { ok: false };
  }
}

/** The next page of Find a book, with what the child has and has reserved. */
export async function catalogueSearchPage(
  kidId: string,
  q: string,
  page: number,
): Promise<FeedPage> {
  if (!okPage(page) || !ID.test(kidId) || typeof q !== 'string' || q.length > 80)
    return { ok: false };
  try {
    const [c, mine, kids] = await Promise.all([
      bff.api.fetch<{ rows: Title[]; page: number; pages: number }>(
        `/library/portal/catalogue?${new URLSearchParams({ q, page: String(page), size: String(PAGE) }).toString()}`,
      ),
      bff.api.fetch<{
        now: Array<{ titleId: string }>;
        reservations: Array<{ titleId: string; status: string }>;
      }>(`/library/portal/borrowers/student/${kidId}`),
      familyKids(),
    ]);
    const kid = kids.find((k) => k.id === kidId);
    if (!kid) return { ok: false };
    const lang = await currentLang();
    const back = `/library?${new URLSearchParams({ view: 'find', ...(q ? { q } : {}) }).toString()}`;
    return {
      ok: true,
      node: (
        <BookItems
          rows={c.rows}
          lang={lang}
          kid={{ id: kid.id, name: kid.name }}
          holding={mine.now.map((b) => b.titleId)}
          reserved={mine.reservations
            .filter((r) => r.status === 'waiting' || r.status === 'ready')
            .map((r) => r.titleId)}
          back={back}
        />
      ),
      more: page < c.pages,
    };
  } catch {
    return { ok: false };
  }
}
