/** Fees → Refunds: the pupils' refunds and the admission fee refunds (docs/design/54). */
export function RefundTabs({ current }: { current: 'pupils' | 'admission' }) {
  return (
    <nav className="ep-lead-views" aria-label="Refunds" style={{ marginBottom: 'var(--sp-3)' }}>
      <a href="/fees/refunds" aria-current={current === 'pupils' ? 'page' : undefined}>
        Pupils&apos; refunds
      </a>
      <a href="/fees/refunds/admission" aria-current={current === 'admission' ? 'page' : undefined}>
        Admission refunds
      </a>
    </nav>
  );
}
