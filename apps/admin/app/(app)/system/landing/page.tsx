import { Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { saveRoleLanding } from '@/lib/dashboard-actions';
import { NAV_ITEMS } from '@/lib/nav';

interface Defaults {
  widgets: Array<{ key: string; title: string }>;
  roles: Array<{
    code: string;
    name: string;
    widgets: string[];
    quickActions: string[];
    custom: boolean;
  }>;
}

/** System → Landing pages: the widgets (in order) and quick actions each role lands on. */
export default async function LandingDefaultsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [d, nav] = await Promise.all([
    apiFetch<Defaults>('/dashboard/defaults'),
    getTranslations('nav'),
  ]);
  const role = d.roles.find((r) => r.code === sp.role) ?? d.roles[0]!;
  const sections = [...new Set(NAV_ITEMS.map((i) => i.section))];
  return (
    <>
      <PageHeader
        kicker="System"
        title="Landing pages"
        description="What each role sees first after signing in: the widgets in order and the quick actions. A widget shows only to people who hold its permission. Each person can still arrange their own page."
      />
      <Notice
        params={{
          ok: sp.ok,
          error: sp.error,
          detail: sp.ok ? `Saved for ${role.name}.` : sp.detail,
        }}
      />
      <nav className="ep-tabs-links" aria-label="Roles" style={{ marginBottom: 'var(--sp-4)' }}>
        {d.roles.map((r) => (
          <a
            key={r.code}
            href={`/system/landing?role=${r.code}`}
            aria-current={r.code === role.code ? 'page' : undefined}
          >
            {r.name}
            {r.custom ? ' ·' : ''}
          </a>
        ))}
      </nav>
      <form action={saveRoleLanding}>
        <input type="hidden" name="role" value={role.code} />
        <Card title={`Widgets of ${role.name}`} style={{ marginBottom: 'var(--sp-4)' }}>
          <p className="ep-field__help">
            Tick the widgets and number them in the order they appear (1 = first).
          </p>
          <div className="db-arrange__pins">
            {d.widgets.map((w) => {
              const at = role.widgets.indexOf(w.key);
              return (
                <div
                  key={w.key}
                  style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                >
                  <label htmlFor={`o-${w.key}`} className="ep-sr-only">
                    Order of {w.title}
                  </label>
                  <input
                    id={`o-${w.key}`}
                    name={`o-${w.key}`}
                    type="number"
                    min={1}
                    max={40}
                    className="ep-input"
                    style={{ width: '4.5rem' }}
                    defaultValue={at >= 0 ? at + 1 : ''}
                  />
                  <label>
                    <input type="checkbox" name={`w-${w.key}`} defaultChecked={at >= 0} /> {w.title}
                  </label>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Quick actions" style={{ marginBottom: 'var(--sp-4)' }}>
          <p className="ep-field__help">
            None ticked: the first pages of the person’s menu. A person sees only the actions they
            may open.
          </p>
          {sections.map((sec) => (
            <fieldset key={sec} style={{ border: 0, padding: 0, margin: '0 0 var(--sp-3)' }}>
              <legend className="ep-field__label">{nav(sec)}</legend>
              <div className="db-arrange__pins">
                {NAV_ITEMS.filter((i) => i.section === sec && i.href !== '/').map((i) => (
                  <label key={i.href}>
                    <input
                      type="checkbox"
                      name="qa"
                      value={i.href}
                      defaultChecked={role.quickActions.includes(i.href)}
                    />{' '}
                    {nav(i.label)}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </Card>
        <Button type="submit">Save the landing of {role.name}</Button>
      </form>
    </>
  );
}
