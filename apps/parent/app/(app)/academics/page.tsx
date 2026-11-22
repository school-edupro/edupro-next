import { PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { audienceOf } from '@/components/FamilyShell';
import { Icon } from '@/components/nav-icons';
import { bff } from '@/lib/bff';
import { homeLayout, iconOf, isHidden } from '@/lib/home-layout';
import { currentLang, t } from '@/lib/i18n';
import { canOpen } from '@/lib/portal-menu';

/** The school day's screens as built (when the school has no Academics list of its own). */
const STANDARD = [
  { href: '/attendance', label: 'Attendance', icon: 'check' },
  { href: '/homework', label: 'Daily work', icon: 'book' },
  { href: '/timetable', label: 'Timetable', icon: 'calendar' },
  { href: '/date-sheet', label: 'Exam date sheet', icon: 'calendar' },
  { href: '/results', label: 'Results', icon: 'chart' },
  { href: '/calendar', label: 'Calendar', icon: 'calendar' },
];

/**
 * Academics (docs/design/90): the screens of the school's Academics list, one tap each — the phone bar's Academics
 * place, as the app's Academics tab.
 */
export default async function AcademicsPage() {
  const lang = await currentLang();
  let me;
  try {
    me = await bff.api.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      redirect('/login?error=session-expired');
    throw error;
  }
  const layout = await homeLayout(audienceOf(me));
  // the school's list (hidden screens already left out), else the standard one without the hidden screens
  const items = (layout?.academics?.length ? layout.academics : STANDARD).filter(
    (x) => canOpen(me, x.href) && !isHidden(layout, x.href),
  );
  // the school's name for the tab (docs/design/94, part 3); its Hindi name in Hindi
  const name =
    lang === 'hi' && layout?.academicsLabelHi
      ? layout.academicsLabelHi
      : t(lang, layout?.academicsLabel ?? 'Academics');
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={name}
        description={t(lang, 'The screens of the school day, one tap each.')}
      />
      <ul
        className="ep-card"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
        aria-label={name}
      >
        {items.map((x, i) => (
          <li key={x.href} style={{ borderTop: i ? '1px solid var(--border-default)' : undefined }}>
            <a
              href={x.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-3)',
                padding: 'var(--sp-3) var(--sp-4)',
                minHeight: '3rem',
                color: 'var(--text-body)',
              }}
            >
              <Icon name={iconOf(x.icon)} size={22} />
              <span style={{ flex: 1 }}>{t(lang, x.label)}</span>
              <span aria-hidden="true">›</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
