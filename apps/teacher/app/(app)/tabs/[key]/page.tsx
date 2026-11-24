import { PageHeader } from '@edupro/ui';
import { QuickActions, type QuickTile } from '@/components/QuickActions';
import { currentLang, t } from '@/lib/i18n';
import { myStaffLayout } from '@/lib/staff-layout';
import { screenIcon } from '@/lib/staff-menu';

/**
 * A list tab (docs/design/94, part 3): the phone bar's list tabs on the website, as in the app — the screens the
 * school put in the list that this person can open, in its order, under the school's name for it.
 */
export default async function ListTabPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const lang = await currentLang();
  const list = (await myStaffLayout())?.lists.find((x) => x.key === key) ?? null;
  const name = list ? (lang === 'hi' && list.labelHi ? list.labelHi : t(lang, list.label)) : null;
  const tiles: QuickTile[] = (list?.items ?? [])
    .filter((i) => !i.locked)
    .map((i) => ({
      href: i.href,
      label: t(lang, i.label),
      section: name ?? '',
      icon: screenIcon(i.href, i.icon),
    }));
  // the screens the school put in this tab that the person has no right to open: named, not linked
  const locked = (list?.items ?? []).filter((i) => i.locked);
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'Staff app')}
        title={name ?? t(lang, 'Not available')}
        description={
          list
            ? t(lang, 'The screens of this tab, one tap each.')
            : t(lang, 'Nothing here is open to you.')
        }
      />
      <QuickActions
        tiles={tiles}
        words={{
          search: t(lang, 'Search pages'),
          staff: t(lang, 'Staff app'),
          admin: t(lang, 'Admin app'),
          none: t(lang, 'Nothing here is open to you.'),
          noMatch: t(lang, 'No page matches'),
        }}
      />
      {locked.length ? (
        <section
          className="ep-card"
          aria-labelledby="tab-locked"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="tab-locked" className="ep-card__title">
            {t(lang, 'Not open to you')}
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {t(
              lang,
              'The school put these in this tab; your role does not give you the right to open them. Ask the office if you need one.',
            )}
          </p>
          <ul className="ep-list" data-testid="tab-locked">
            {locked.map((i) => (
              <li key={i.href}>{t(lang, i.label)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
