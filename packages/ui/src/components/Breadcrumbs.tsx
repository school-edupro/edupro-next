export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ep-breadcrumbs">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} aria-current={last ? 'page' : undefined}>
              {c.href && !last ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
