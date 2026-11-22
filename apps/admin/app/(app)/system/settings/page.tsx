import { Badge, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { APP_LAYOUT_LINKS, sectionsFor, valueText, type SettingRow } from '@/lib/settings-sections';
import { SettingsSearch, type SearchEntry } from './SettingsSearch';

/**
 * School settings (docs/design/95): a card per area — what it covers, a few of its values, how many differ from the
 * standard — opening that area's form; a search finds a setting by its name; App layouts link to their own pages.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('platform.settings.view')) notFound();
  let rows: SettingRow[];
  try {
    rows = (await apiFetch<{ data: SettingRow[] }>('/platform/settings')).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const sections = sectionsFor(rows);
  const entries: SearchEntry[] = sections.flatMap((s) =>
    s.fields.map((f) => ({
      key: f.setting,
      label: f.label,
      help: f.help,
      section: s.id,
      sectionTitle: s.title,
      value: valueText(f, byKey.get(f.setting)?.value),
    })),
  );
  return (
    <>
      <PageHeader
        kicker="System"
        title="School settings"
        description="How the school works in EduPro, area by area. Open an area to see and change its settings; a change applies from today unless you choose a later date."
      />
      <Notice params={sp} />
      <SettingsSearch entries={entries} />
      <div className="ep-setup-sections" style={{ marginTop: 0 }}>
        {sections.map((s) => {
          const changed = s.fields.filter((f) => byKey.get(f.setting)?.isDefault === false).length;
          const elsewhere = s.fields.filter((f) => f.ownPage).length;
          const shown = s.fields.filter((f) => f.control.kind !== 'json').slice(0, 3);
          return (
            <section key={s.id} className="ep-card" aria-labelledby={`set-card-${s.id}`}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                }}
              >
                <h2 id={`set-card-${s.id}`} className="ep-card__title" style={{ margin: 0 }}>
                  <a href={`/system/settings/${s.id}`}>{s.title}</a>
                </h2>
                {changed ? (
                  <Badge tone="info">{`${String(changed)} changed`}</Badge>
                ) : (
                  <Badge tone="neutral">Standard</Badge>
                )}
              </div>
              <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 var(--sp-3)' }}>
                {s.summary}
              </p>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 'var(--sp-1) var(--sp-3)',
                  margin: 0,
                  fontSize: 'var(--fs-small)',
                }}
              >
                {shown.map((f) => (
                  <div key={f.setting} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{f.label}</dt>
                    <dd style={{ margin: 0, textAlign: 'right', fontWeight: 'var(--fw-semibold)' }}>
                      {valueText(f, byKey.get(f.setting)?.value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p style={{ margin: 'var(--sp-3) 0 0' }}>
                <a href={`/system/settings/${s.id}`} aria-label={`Open ${s.title}`}>
                  {`Open · ${String(s.fields.length)} settings`}
                </a>
                {elsewhere ? (
                  <span className="ep-field__help" style={{ marginLeft: 'var(--sp-2)' }}>
                    {`${String(elsewhere)} on their own pages`}
                  </span>
                ) : null}
              </p>
            </section>
          );
        })}
        <section className="ep-card" aria-labelledby="set-card-app-layouts">
          <h2 id="set-card-app-layouts" className="ep-card__title" style={{ margin: 0 }}>
            App layouts
          </h2>
          <p className="ep-field__help" style={{ margin: 'var(--sp-1) 0 var(--sp-3)' }}>
            What the mobile apps and the websites show; each is a draft with a preview, published
            when ready.
          </p>
          <ul className="ep-setup-links">
            {APP_LAYOUT_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href}>
                  <strong>{l.label}</strong>
                </a>
                <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                  {l.help}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
