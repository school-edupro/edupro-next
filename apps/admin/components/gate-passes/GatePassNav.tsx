import { Alert } from '@edupro/ui';

/** A page of the module and the permission it needs (null = every member of staff). */
const TABS: Array<{ href: string; label: string; permission: string | null }> = [
  { href: '/engagement/gate-passes', label: 'Front desk', permission: 'engagement.gate_pass.view' },
  {
    href: '/engagement/gate-passes/new',
    label: 'New pupil pass',
    permission: 'engagement.gate_pass.issue',
  },
  { href: '/engagement/gate-passes/approvals', label: 'To approve', permission: null },
  { href: '/engagement/gate-passes/gate', label: 'Gate', permission: 'engagement.gate_pass.gate' },
  { href: '/engagement/gate-passes/mine', label: 'My gate passes', permission: null },
  {
    href: '/engagement/gate-passes/setup',
    label: 'Set-up',
    permission: 'engagement.gate_pass_setup.manage',
  },
];

const OK: Record<string, string> = {
  requested: 'Gate pass requested. It has gone for approval.',
  approved: 'Approved at your level.',
  rejected: 'Rejected. The family or the employee has been told.',
  handed_over: 'Handed over. The gate can now let the child out.',
  out: 'Marked out at the gate.',
  in: 'Marked in at the gate.',
  cancelled: 'Gate pass cancelled.',
  saved: 'Saved.',
};

/**
 * The gate pass screens' own tabs: only the pages this person's role may open (the front desk sees the
 * register and the hand-over, the gate only the gate, an approver To approve, every employee My gate
 * passes), and the message a finished action leaves behind.
 */
export function GatePassNav({
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
      <nav
        className="ep-tabs-links"
        aria-label="Gate passes"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
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
