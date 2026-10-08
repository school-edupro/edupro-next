/** Fee set-up is one menu entry; these tabs are its screens. Each thing is set in one place only. */
const TABS: Array<{ href: string; label: string }> = [
  { href: '/masters/fees', label: 'Heads, discounts, slabs, banks' },
  { href: '/fees/masters', label: 'Fee calendar, late fee, receipt numbers' },
  { href: '/fees/structures', label: 'Class fee structure' },
  { href: '/fees/rules', label: 'Class rules, payment modes' },
];

export function FeeSetupNav({ current }: { current: string }) {
  return (
    <nav
      className="ep-tabs-links ep-tabs__list--wrap"
      aria-label="Fee setup"
      style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
    >
      {TABS.map((t) => (
        <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
