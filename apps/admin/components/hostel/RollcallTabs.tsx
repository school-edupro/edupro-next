/** Roll-call: the rolls of a period, and the month register. */
export function RollcallTabs({ current }: { current: 'rolls' | 'register' }) {
  return (
    <nav className="ep-tabs-links" aria-label="Roll-call" style={{ marginBottom: 'var(--sp-4)' }}>
      <a href="/hostel/rollcall" aria-current={current === 'rolls' ? 'page' : undefined}>
        Roll-calls
      </a>
      <a
        href="/hostel/rollcall/register"
        aria-current={current === 'register' ? 'page' : undefined}
      >
        Register
      </a>
    </nav>
  );
}
