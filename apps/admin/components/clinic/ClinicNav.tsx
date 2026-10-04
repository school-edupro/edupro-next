import { Alert } from '@edupro/ui';

const TABS: Array<{ href: string; label: string; permission: string }> = [
  { href: '/engagement/clinic', label: 'Dashboard', permission: 'engagement.clinic.view' },
  {
    href: '/engagement/clinic/visits',
    label: 'Clinic visits',
    permission: 'engagement.clinic.view',
  },
  {
    href: '/engagement/clinic/visits/new',
    label: 'New visit',
    permission: 'engagement.clinic.manage',
  },
  {
    href: '/engagement/clinic/checkups',
    label: 'Health check-ups',
    permission: 'engagement.clinic.view',
  },
  {
    href: '/engagement/clinic/stock',
    label: 'Medicine stock',
    permission: 'engagement.clinic.view',
  },
  {
    href: '/engagement/clinic/setup',
    label: 'Set-up',
    permission: 'engagement.clinic_setup.manage',
  },
];
const OK: Record<string, string> = {
  saved: 'Saved.',
  closed: 'Time out recorded.',
  received: 'Stock received.',
  written_off: 'Stock written off.',
  visit: 'Visit recorded.',
};

/** The clinic screens' own tabs (only what this person's role may open) and the last action's message. */
export function ClinicNav({
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
      <nav className="ep-tabs-links" aria-label="Clinic" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.filter((t) => permissions.includes(t.permission)).map((t) => (
          <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {ok && OK[ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[ok]}</Alert>
        </div>
      ) : null}
    </>
  );
}
