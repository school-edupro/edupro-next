import { chosenChild, familyKids } from '@/lib/child';
import { t, type Lang } from '@/lib/i18n';

/**
 * The sibling switch shown under the title of every page: one pill per child, the chosen one marked.
 * Choosing a child here changes it for the whole portal. A family with one child (and a student login)
 * sees nothing.
 */
export async function ChildSwitch({
  lang,
  back,
  current,
}: {
  lang: Lang;
  /** The page to come back to after switching. */
  back: string;
  /** The child this page is showing (when the link named one). */
  current?: string | null;
}) {
  const kids = await familyKids();
  if (kids.length < 2) return null;
  const chosen = await chosenChild(current);
  return (
    <nav
      className="pp-kids"
      aria-label={t(lang, 'Choose a child')}
      style={{ marginBottom: 'var(--sp-4)' }}
    >
      {kids.map((c) => (
        <a
          key={c.id}
          href={`/api/child?id=${c.id}&back=${encodeURIComponent(back)}`}
          aria-current={c.id === chosen?.id ? 'page' : undefined}
        >
          {c.name}
          {c.section ? <span> · {c.section}</span> : null}
        </a>
      ))}
    </nav>
  );
}
