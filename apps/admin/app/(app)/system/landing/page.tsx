import { Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { QuickMenuEditor, type MenuPage } from '@/components/dashboard/QuickMenuEditor';
import { ICON_NAMES, SECTION_ICON } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import {
  applyRoleLanding,
  copyRoleLanding,
  removeRoleLanding,
  saveRoleLanding,
} from '@/lib/dashboard-actions';
import { NAV_ITEMS } from '@/lib/nav';

interface WidgetInfo {
  key: string;
  title: string;
  wide: boolean;
  days?: [number, number, number];
  count?: [number, number, number];
}
interface RoleInfo {
  code: string;
  name: string;
  builtIn: boolean;
  widgets: string[];
  quickActions: Array<{ href: string; label?: string; icon?: string }>;
  settings: Record<string, { title?: string; size?: string; days?: number; count?: number }>;
  locked: boolean;
  custom: boolean;
  users: number;
  personal: number;
}

/**
 * System → Landing pages: for each role (built-in, and the school's own from Access) the widgets in
 * order with their title, size, days ahead or rows shown; the quick menu in order with own names, icons
 * and the school's links; the lock on arranging; copy from another role, push to users, preview.
 */
export default async function LandingDefaultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    ok?: string;
    n?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [d, nav] = await Promise.all([
    apiFetch<{ widgets: WidgetInfo[]; roles: RoleInfo[] }>('/dashboard/defaults'),
    getTranslations('nav'),
  ]);
  const role = d.roles.find((r) => r.code === sp.role) ?? d.roles[0]!;
  const pages: MenuPage[] = NAV_ITEMS.filter((i) => i.href !== '/').map((i) => ({
    href: i.href,
    label: nav(i.label),
    sectionLabel: nav(i.section),
    icon: SECTION_ICON[i.section] ?? 'grid',
  }));
  // the role's widgets first in their order, then the others
  const widgets = [
    ...role.widgets.flatMap((k) => d.widgets.filter((w) => w.key === k)),
    ...d.widgets.filter((w) => !role.widgets.includes(w.key)),
  ];
  const okText: Record<string, string> = {
    saved: `Saved for ${role.name}.`,
    copied: `Copied to ${role.name}. Check it and save if you change anything.`,
    applied: `${sp.n ?? '0'} ${sp.n === '1' ? 'person' : 'people'} of ${role.name} now see the role’s page.`,
    removed: `${role.name} is back to the built-in page.`,
  };
  const tab = (r: RoleInfo) => (
    <a
      key={r.code}
      href={`/system/landing?role=${encodeURIComponent(r.code)}`}
      aria-current={r.code === role.code ? 'page' : undefined}
    >
      {r.name}
      {r.custom ? <span className="ep-sr-only"> (set by the school)</span> : null}
      {r.custom ? ' ·' : ''}
    </a>
  );
  return (
    <>
      <PageHeader
        kicker="System"
        title="Landing pages"
        description="What each role sees first after signing in. A widget shows only to people who hold its permission. A role marked · has the school’s own settings."
      />
      <Notice
        params={{
          ok: sp.ok,
          error: sp.error,
          detail: sp.ok ? (okText[sp.ok] ?? sp.detail) : sp.detail,
        }}
      />
      <nav className="ep-tabs-links" aria-label="Built-in roles">
        {d.roles.filter((r) => r.builtIn).map(tab)}
      </nav>
      {d.roles.some((r) => !r.builtIn) ? (
        <>
          <p className="ep-kicker db-lp__group">The school’s roles</p>
          <nav className="ep-tabs-links" aria-label="The school’s roles">
            {d.roles.filter((r) => !r.builtIn).map(tab)}
          </nav>
        </>
      ) : null}

      <Card title={role.name} className="db-lp__card">
        <p className="db-lp__facts">
          {role.users} {role.users === 1 ? 'person holds' : 'people hold'} this role ·{' '}
          {role.personal} arranged their own page ·{' '}
          {role.custom ? 'school’s own settings' : 'built-in page'}
          {role.locked ? ' · locked' : ''}
        </p>
        <div className="db-lp__tools">
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/system/landing/preview?role=${encodeURIComponent(role.code)}`}
          >
            Preview as {role.name}
          </a>
          <form action={copyRoleLanding} className="db-qm__inline">
            <input type="hidden" name="role" value={role.code} />
            <label className="ep-sr-only" htmlFor="copy-from">
              Copy from role
            </label>
            <select id="copy-from" name="from" className="ep-select" required defaultValue="">
              <option value="" disabled>
                Copy from…
              </option>
              {d.roles
                .filter((r) => r.code !== role.code)
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
            </select>
            <Button type="submit" size="sm" variant="secondary">
              Copy
            </Button>
          </form>
          <ConfirmAction
            action={applyRoleLanding}
            fields={{ role: role.code }}
            label="Push to all users"
            title={`Push the page of ${role.name} to its users?`}
            confirmLabel="Push to users"
            confirmVariant="danger"
          >
            The own arrangement of {role.personal} {role.personal === 1 ? 'person' : 'people'}{' '}
            holding {role.name} is removed; they see this role’s page from their next visit. This
            cannot be undone.
          </ConfirmAction>
          {role.custom ? (
            <ConfirmAction
              action={removeRoleLanding}
              fields={{ role: role.code }}
              label="Back to built-in"
              title={`Drop the school’s settings of ${role.name}?`}
              confirmLabel="Use the built-in page"
              confirmVariant="danger"
            >
              Widgets, titles, quick menu and the lock set for {role.name} are removed; the role
              lands on the built-in page.
            </ConfirmAction>
          ) : null}
        </div>
      </Card>

      <form action={saveRoleLanding}>
        <input type="hidden" name="role" value={role.code} />
        <Card title="Widgets" className="db-lp__card">
          <p className="ep-field__help">
            Tick the widgets and number them in the order they appear (1 = first). Leave a title
            empty to keep the standard one.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table db-lp__table">
              <thead>
                <tr>
                  <th scope="col">Show</th>
                  <th scope="col">Order</th>
                  <th scope="col">Widget</th>
                  <th scope="col">Title shown</th>
                  <th scope="col">Size</th>
                  <th scope="col">Setting</th>
                </tr>
              </thead>
              <tbody>
                {widgets.map((w) => {
                  const at = role.widgets.indexOf(w.key);
                  const s = role.settings[w.key] ?? {};
                  return (
                    <tr key={w.key}>
                      <td>
                        <input
                          type="checkbox"
                          name={`w-${w.key}`}
                          id={`w-${w.key}`}
                          defaultChecked={at >= 0}
                          aria-label={`Show ${w.title}`}
                        />
                      </td>
                      <td>
                        <input
                          name={`o-${w.key}`}
                          type="number"
                          min={1}
                          max={40}
                          className="ep-input db-lp__num"
                          defaultValue={at >= 0 ? at + 1 : ''}
                          aria-label={`Order of ${w.title}`}
                        />
                      </td>
                      <td>
                        <label htmlFor={`w-${w.key}`}>{w.title}</label>
                      </td>
                      <td>
                        <input
                          name={`t-${w.key}`}
                          className="ep-input"
                          maxLength={40}
                          placeholder={w.title}
                          defaultValue={s.title ?? ''}
                          aria-label={`Title shown for ${w.title}`}
                        />
                      </td>
                      <td>
                        <select
                          name={`s-${w.key}`}
                          className="ep-select"
                          defaultValue={s.size ?? (w.wide ? 'wide' : 'normal')}
                          aria-label={`Size of ${w.title}`}
                        >
                          <option value="normal">Normal</option>
                          <option value="wide">Wide</option>
                        </select>
                      </td>
                      <td>
                        {w.days ? (
                          <label className="db-lp__setting">
                            <input
                              name={`d-${w.key}`}
                              type="number"
                              min={w.days[0]}
                              max={w.days[1]}
                              className="ep-input db-lp__num"
                              defaultValue={s.days ?? w.days[2]}
                            />{' '}
                            days ahead
                          </label>
                        ) : w.count ? (
                          <label className="db-lp__setting">
                            <input
                              name={`c-${w.key}`}
                              type="number"
                              min={w.count[0]}
                              max={w.count[1]}
                              className="ep-input db-lp__num"
                              defaultValue={s.count ?? w.count[2]}
                            />{' '}
                            rows shown
                          </label>
                        ) : (
                          <span className="db-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Quick menu" className="db-lp__card">
          <p className="ep-field__help">
            The tiles in this order. A person sees only the pages they may open; a school link is
            shown to everyone of the role and opens in a new tab.
          </p>
          <QuickMenuEditor initial={role.quickActions} pages={pages} icons={ICON_NAMES} />
        </Card>
        <Card title="Arranging" className="db-lp__card">
          <label className="db-lp__setting">
            <input type="checkbox" name="locked" defaultChecked={role.locked} /> Lock this page:
            people of {role.name} cannot arrange their own page, and their own arrangement is not
            used
          </label>
        </Card>
        <Button type="submit">Save the landing of {role.name}</Button>
      </form>
    </>
  );
}
