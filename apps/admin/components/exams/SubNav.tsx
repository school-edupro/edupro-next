/** Two or three pages under one exam tab (marks entry and status; attendance and health); `current` is a path. */
export function SubNav({
  label,
  items,
  current,
}: {
  label: string;
  items: Array<{ href: string; label: string }>;
  current: string;
}) {
  return (
    <nav aria-label={label} style={{ marginBottom: 'var(--sp-3)' }}>
      <ul className="ep-xchips">
        {items.map((x) => (
          <li key={x.href} style={{ padding: 0, border: 0, background: 'none' }}>
            <a href={x.href} aria-current={x.href.split('?')[0] === current ? 'page' : undefined}>
              {x.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
