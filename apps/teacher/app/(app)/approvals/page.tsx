import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Inbox {
  total: number;
  kinds: Array<{ kind: string; label: string; count: number }>;
  items: Array<{
    kind: string;
    id: string;
    title: string;
    detail: string | null;
    at: string | null;
    adminHref: string | null;
    /** the item's page on this website (a full address) */
    staffUrl: string | null;
  }>;
  unavailable: Array<{ kind: string; label: string }>;
}

/** Each kind's own list page on this website (where there is one). */
const LIST: Record<string, string> = {
  leave: '/leaves',
  query: '/queries',
  staff_leave: '/leave-approvals',
  staff_leave_cancel: '/leave-approvals',
  staff_regularisation: '/attendance-corrections',
  gate_pass: '/gate-passes',
  lesson: '/lesson-plans',
  consent: '/consent-approvals',
  staff_profile: '/profile/approvals',
  admission: '/admission-approvals',
  exit: '/exit-approvals',
  no_dues: '/no-dues',
};

/** The path of a full address on this website (its own origin may differ behind a proxy). */
const pathOf = (url: string | null) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url.startsWith('/') ? url : null;
  }
};
const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * My approvals on the staff website (as the admin's and the app's header): everything waiting for this person's
 * decision, every kind — student leave, colleagues' leave, gate passes, lessons, consents, profile changes … — read
 * from the server's approvals inbox, each item opening its own page here.
 */
export default async function StaffApprovalsPage() {
  const lang = await currentLang();
  let box: Inbox;
  try {
    box = await bff.api.fetch<Inbox>('/approvals/inbox');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const groups = box.kinds.filter((k) => k.count > 0);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Approvals')}
        title={t(lang, 'Approvals waiting for me')}
        description={t(
          lang,
          'Everything waiting for your decision, every kind, newest first in each.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {box.unavailable.length ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Could not be read just now:')}{' '}
          {box.unavailable.map((u) => t(lang, u.label)).join(', ')}
        </div>
      ) : null}
      {groups.length === 0 ? <Card>{t(lang, 'Nothing waits for your decision.')}</Card> : null}
      {groups.map((g) => {
        const items = box.items
          .filter((i) => i.kind === g.kind)
          .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
        const list = LIST[g.kind];
        return (
          <Card
            key={g.kind}
            title={t(lang, g.label)}
            actions={<Badge tone="warning">{String(g.count)}</Badge>}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((i) => {
                const href = pathOf(i.staffUrl);
                return (
                  <li
                    key={`${i.kind}-${i.id}`}
                    style={{
                      padding: 'var(--sp-2) 0',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {href ? (
                      <a
                        href={href}
                        style={{ textDecoration: 'underline', fontWeight: 'var(--fw-semibold)' }}
                      >
                        {i.title}
                      </a>
                    ) : (
                      <strong>{i.title}</strong>
                    )}
                    <div className="ep-field__help">
                      {[i.detail, when(i.at), href ? null : t(lang, 'On the office website')]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </li>
                );
              })}
            </ul>
            {list ? (
              <p style={{ margin: 'var(--sp-2) 0 0' }}>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={list}>
                  {t(lang, 'Open the list')}
                </a>
              </p>
            ) : null}
          </Card>
        );
      })}
    </main>
  );
}
