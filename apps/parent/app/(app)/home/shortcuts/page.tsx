import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { audienceOf } from '@/components/FamilyShell';
import { Icon } from '@/components/nav-icons';
import { bff } from '@/lib/bff';
import { homeLayout, iconOf } from '@/lib/home-layout';
import { currentLang, t } from '@/lib/i18n';
import { resetShortcuts, saveShortcuts } from './actions';

const MIN = 4;
const MAX = 12;

/**
 * Edit shortcuts (docs/design/90): a parent's or student's own Home shortcuts — 4 to 12 screens they can open, in their
 * order — kept for them on the website and in the app; "Reset to the school's" drops them. The list being edited
 * travels in the address (`s`) until Save, so moving, removing and adding need no script.
 */
export default async function ShortcutsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; add?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
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
  if (!layout)
    return (
      <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
        <PageHeader kicker="EduPro" title={t(lang, 'Edit shortcuts')} />
        <Card>{t(lang, 'Shortcuts cannot be changed just now. Please try again later.')}</Card>
      </main>
    );
  const byHref = new Map(layout.screens.map((x) => [x.href, x]));
  const saved = layout.shortcuts.map((x) => x.href);
  const list = (sp.s !== undefined ? sp.s.split(',') : saved).filter(
    (h, i, all) => byHref.has(h) && all.indexOf(h) === i,
  );
  if (sp.add && byHref.has(sp.add) && !list.includes(sp.add) && list.length < MAX)
    list.push(sp.add);
  const changed = list.join(',') !== saved.join(',');
  const href = (next: string[]) => `/home/shortcuts?s=${encodeURIComponent(next.join(','))}`;
  const moved = (i: number, j: number) => {
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return href(next);
  };
  const free = layout.screens.filter((x) => !list.includes(x.href));
  const fits = list.length >= MIN && list.length <= MAX;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Home')}
        title={t(lang, 'Edit shortcuts')}
        description={t(
          lang,
          'Pick 4 to 12 screens for your Home, in your order. They follow you on the app and the website.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok === 'saved' ? (
        <p className="ep-alert ep-alert--success" role="status">
          {t(lang, 'Your shortcuts are saved.')}
        </p>
      ) : sp.ok === 'reset' ? (
        <p className="ep-alert ep-alert--success" role="status">
          {t(lang, 'Back to the school’s shortcuts.')}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.error}
        </p>
      ) : null}
      <Card
        title={`${t(lang, 'Your Home shortcuts')} (${list.length})`}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {layout.ownShortcuts && !changed
            ? t(lang, 'These are your own shortcuts.')
            : !layout.ownShortcuts && !changed
              ? t(lang, 'These are the school’s shortcuts.')
              : t(lang, 'Not saved yet.')}
        </p>
        <ol
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--sp-2)' }}
        >
          {list.map((h, i) => {
            const x = byHref.get(h)!;
            return (
              <li
                key={h}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  borderTop: i ? '1px solid var(--border-default)' : undefined,
                  paddingTop: i ? 'var(--sp-2)' : undefined,
                }}
              >
                <Icon name={iconOf(x.icon)} size={20} />
                <span style={{ flex: '1 1 10rem', fontWeight: 'var(--fw-semibold)' }}>
                  {t(lang, x.label)}
                </span>
                {i > 0 ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={moved(i, i - 1)}
                    aria-label={`${t(lang, 'Move up')}: ${t(lang, x.label)}`}
                  >
                    {t(lang, 'Move up')}
                  </a>
                ) : null}
                {i < list.length - 1 ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={moved(i, i + 1)}
                    aria-label={`${t(lang, 'Move down')}: ${t(lang, x.label)}`}
                  >
                    {t(lang, 'Move down')}
                  </a>
                ) : null}
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={href(list.filter((y) => y !== h))}
                  aria-label={`${t(lang, 'Remove')}: ${t(lang, x.label)}`}
                >
                  {t(lang, 'Remove')}
                </a>
              </li>
            );
          })}
        </ol>
        {free.length && list.length < MAX ? (
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            <input type="hidden" name="s" value={list.join(',')} />
            <label className="ep-field" style={{ flex: '1 1 14rem' }}>
              <span className="ep-field__label">{t(lang, 'Add a screen')}</span>
              <select className="ep-select" name="add" defaultValue="">
                <option value="" disabled>
                  {t(lang, 'Choose')}
                </option>
                {free.map((x) => (
                  <option key={x.href} value={x.href}>
                    {t(lang, x.label)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              {t(lang, 'Add')}
            </Button>
          </form>
        ) : null}
        {!fits ? (
          <p className="ep-field__help" role="status" style={{ marginBottom: 0 }}>
            {t(lang, 'Choose 4 to 12 shortcuts.')}
          </p>
        ) : null}
      </Card>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <form action={saveShortcuts}>
          <input type="hidden" name="shortcuts" value={list.join(',')} />
          <Button type="submit" disabled={!fits || !changed}>
            {t(lang, 'Save')}
          </Button>
        </form>
        {changed ? (
          <a className="ep-btn ep-btn--ghost" href="/home/shortcuts">
            {t(lang, 'Cancel')}
          </a>
        ) : null}
        {layout.ownShortcuts ? (
          <form action={resetShortcuts}>
            <Button type="submit" variant="ghost">
              {t(lang, 'Reset to the school’s')}
            </Button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
