import { PageHeader } from '@edupro/ui';
import { QuickActions, type QuickTile } from '@/components/QuickActions';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { CLASSES_GROUP, myStaffLayout, staffGroups } from '@/lib/staff-layout';
import { screenIcon } from '@/lib/staff-menu';

/**
 * Classes (docs/design/94, part 2): the phone bar's Classes tab on the website, as in the app. The screens of the
 * "My classes" group this person may open (daily work, marks, timetable and the rest), in the school's order and with
 * hidden screens left out.
 */
export default async function ClassesPage() {
  const lang = await currentLang();
  const me = await bff.api.me();
  const mine = await myStaffLayout();
  const group = staffGroups(me, lang, mine, mine?.waiting).find((g) => g.id === CLASSES_GROUP);
  const tiles: QuickTile[] = (group?.items ?? []).map((i) => ({
    href: i.href,
    label: t(lang, i.label),
    section: group?.label ?? '',
    icon: screenIcon(i.href, group?.icon ?? 'book'),
  }));
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'Classes')}
        title={group?.label ?? t(lang, 'My classes')}
        description={t(lang, 'The screens of my classes, one tap each.')}
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
