'use server';
/**
 * The staff website's lists that load as they scroll (Messages: messages and notices; Office orders; Forms and
 * declarations): the next page of 10, and acknowledging a notice in place.
 */
import { bff } from './bff';

/** How many a page of the Messages section brings: the latest 10, then 10 more as the person scrolls. */
const PAGE = 10;

/** The next page of my messages (newest first) for the list that loads as it scrolls. */
export async function loadInbox(
  page: number,
): Promise<{ ok: true; data: unknown[]; more: boolean } | { ok: false }> {
  if (!Number.isInteger(page) || page < 1 || page > 500) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: unknown[]; page: { more: boolean } }>(
      `/comms/inbox?page=${String(page)}&size=${String(PAGE)}`,
    );
    return { ok: true, data: r.data, more: r.page.more };
  } catch {
    return { ok: false };
  }
}

/** The next page of the notices for me (pinned first, then the newest); `kind`: office orders only, etc. */
export async function loadNotices(
  page: number,
  kind?: 'notice' | 'circular' | 'office_order',
): Promise<{ ok: true; data: unknown[]; more: boolean } | { ok: false }> {
  if (!Number.isInteger(page) || page < 1 || page > 500) return { ok: false };
  if (kind && !['notice', 'circular', 'office_order'].includes(kind)) return { ok: false };
  try {
    const r = await bff.api.fetch<{ data: unknown[]; page: { total: number } }>(
      `/academics/notices?page=${String(page)}&size=${String(PAGE)}${kind ? `&kind=${kind}` : ''}`,
    );
    return { ok: true, data: r.data, more: page * PAGE < r.page.total };
  } catch {
    return { ok: false };
  }
}

/** The next page of the forms and declarations asked of me as staff (the latest first). */
export async function loadConsents(
  page: number,
): Promise<{ ok: true; data: unknown[]; more: boolean } | { ok: false }> {
  if (!Number.isInteger(page) || page < 1 || page > 500) return { ok: false };
  try {
    const r = await bff.api.fetch<{ forms: unknown[]; page: { total: number } }>(
      `/engagement/mine/consent-forms?part=staff&page=${String(page)}&size=${String(PAGE)}`,
    );
    return { ok: true, data: r.forms, more: page * PAGE < r.page.total };
  } catch {
    return { ok: false };
  }
}

/** I have seen this notice (when the school asks for it); the card updates in place. */
export async function ackNotice(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{1,18}$/.test(id)) return { ok: false };
  try {
    await bff.api.fetch('/academics/acks', {
      method: 'POST',
      body: JSON.stringify({ type: 'notice', id }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : undefined };
  }
}
