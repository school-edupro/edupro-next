/** The fee counter's two desks: pupils' fees, and admission fees for registrations (docs/design/52). */
export function CashierTabs({
  current,
  pupils,
  admission,
}: {
  current: 'pupils' | 'admission';
  pupils: boolean;
  admission: boolean;
}) {
  if (!(pupils && admission)) return null;
  return (
    <nav className="ep-lead-views" aria-label="Counter" style={{ marginBottom: 'var(--sp-3)' }}>
      <a href="/fees/cashier" aria-current={current === 'pupils' ? 'page' : undefined}>
        Pupils&apos; fees
      </a>
      <a href="/fees/cashier/admission" aria-current={current === 'admission' ? 'page' : undefined}>
        Admission fees
      </a>
    </nav>
  );
}
