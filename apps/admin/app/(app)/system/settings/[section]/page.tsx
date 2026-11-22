import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { anchorOf, sectionsFor, valueText, type SettingRow } from '@/lib/settings-sections';
import { SettingsForm } from './SettingsForm';

/**
 * One area of the school settings (docs/design/95): its settings with plain names and fitting controls, saved
 * together; those edited on their own pages shown as they are, with a link there.
 */
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: id } = await params;
  const me = await getMe();
  if (!me.permissions.includes('platform.settings.view')) notFound();
  let rows: SettingRow[];
  try {
    rows = (await apiFetch<{ data: SettingRow[] }>('/platform/settings')).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const section = sectionsFor(rows).find((s) => s.id === id);
  if (!section) notFound();
  const canEdit = me.permissions.includes('platform.settings.edit');
  const here = section.fields.filter((f) => !f.ownPage);
  const elsewhere = section.fields.filter((f) => f.ownPage);
  // the role names for the role pickers (codes alone when the roles cannot be read)
  const roles = here.some((f) => f.control.kind === 'roles')
    ? await apiFetch<
        { data: Array<{ code: string; name: string }> } | Array<{ code: string; name: string }>
      >('/access/roles')
        .then((r) => (Array.isArray(r) ? r : r.data).map((x) => ({ value: x.code, label: x.name })))
        .catch(() => [])
    : [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'School settings', href: '/system/settings' }, { label: section.title }]}
      />
      <PageHeader kicker="School settings" title={section.title} description={section.summary} />
      {section.advanced ? (
        <p className="ep-alert ep-alert--warning" role="note">
          For Mobilise support: these settings change how the old apps, the pilot and the reports
          behave. Change them only when support asks.
        </p>
      ) : null}
      {canEdit ? null : (
        <p className="ep-alert ep-alert--info" role="status">
          You can see these settings; changing them needs the right to edit settings.
        </p>
      )}
      {here.length ? (
        <SettingsForm
          sectionTitle={section.title}
          advanced={section.advanced === true}
          fields={here}
          rows={here.map((f) => byKey.get(f.setting)).filter((r): r is SettingRow => !!r)}
          roles={roles}
          canEdit={canEdit}
        />
      ) : null}
      {elsewhere.length ? (
        <section
          className="ep-card"
          aria-labelledby="set-elsewhere"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="set-elsewhere" className="ep-card__title">
            Set on their own pages
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            As they are now; change them where they are kept.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
            {elsewhere.map((f) => (
              <li
                key={f.setting}
                id={anchorOf(f.setting)}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: 'var(--sp-3) 0',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ flex: '1 1 16rem' }}>
                  <strong>{f.label}</strong>
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {f.help}
                  </span>
                </span>
                <span style={{ fontWeight: 'var(--fw-semibold)' }}>
                  {valueText(f, byKey.get(f.setting)?.value)}
                </span>
                <a href={f.ownPage!.href}>{`Change on ${f.ownPage!.label}`}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {section.related?.length ? (
        <section
          className="ep-card"
          aria-labelledby="set-related"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="set-related" className="ep-card__title">
            Goes with
          </h2>
          <ul className="ep-setup-links">
            {section.related.map((l) => (
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
      ) : null}
    </>
  );
}
