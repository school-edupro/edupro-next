import { Alert } from '@edupro/ui';

/** A page of the module and the permission it needs (null = every member of staff). */
const TABS: Array<{ href: string; label: string; permission: string | null }> = [
  { href: '/transport', label: 'Dashboard', permission: 'transport.request.view' },
  { href: '/transport/requests', label: 'Requests', permission: 'transport.request.view' },
  {
    href: '/transport/requests/new',
    label: 'Apply for a student',
    permission: 'transport.request.apply',
  },
  { href: '/transport/requests/approvals', label: 'To approve', permission: null },
  { href: '/transport/history', label: 'Student history', permission: 'transport.request.view' },
  {
    href: '/transport/replacements',
    label: 'Replacement bus',
    permission: 'transport.fleet.view',
  },
  { href: '/transport/papers', label: 'Fleet papers', permission: 'transport.fleet.view' },
  { href: '/transport/setup', label: 'Settings', permission: 'transport.setup.manage' },
];

const OK: Record<string, string> = {
  requested: 'Request made. It has gone for approval.',
  approved: 'Approved at your level.',
  rejected: 'Not approved. The family has been told.',
  saved: 'Saved.',
  replaced: 'Replacement bus saved. The parents of its routes have been told.',
  ended: 'The regular bus is back. The parents have been told.',
  many: 'Done for the requests ticked.',
};

/**
 * The transport request screens' own tabs: only the pages this person's role may open (an approver
 * always has To approve), and the message a finished action leaves behind.
 */
export function TransportNav({
  current,
  permissions,
  ok,
}: {
  current: string;
  permissions: string[];
  ok?: string;
}) {
  return (
    <>
      <nav className="ep-tabs-links" aria-label="Transport" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.filter((t) => t.permission === null || permissions.includes(t.permission)).map(
          (t) => (
            <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
              {t.label}
            </a>
          ),
        )}
      </nav>
      {ok && OK[ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[ok]}</Alert>
        </div>
      ) : null}
    </>
  );
}
