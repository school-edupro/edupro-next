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
  const tiles: QuickTile[] = (list?.items ?? []).map((i) => ({
    href: i.href,
    label: t(lang, i.label),
    section: name ?? '',
    icon: screenIcon(i.href, i.icon),
  }));
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
    </main>
  );
}
