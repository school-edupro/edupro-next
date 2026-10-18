import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import type { ConsentForm } from '@/components/consents/types';
import { changeConsentShare } from '@/lib/consent-actions';
import { apiFetch } from '@/lib/api';

const OK: Record<string, string> = {
  shared: 'Saved: the form is shared.',
  removed: 'Removed: they no longer see this form.',
};
const LEVEL = {
  viewer: 'View: answers, register, Excel / PDF, remind, analytics',
  editor: 'Edit: also change, publish, close, fill on behalf',
} as const;

/**
 * Share one consent form (docs/design/28-consent-forms.md): with a staff member (their login) or a role,
 * to view or to edit. Those who manage consent forms always see every form.
 */
export default async function ConsentSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [f, sh] = await Promise.all([
    apiFetch<ConsentForm>(`/engagement/consent-forms/${id}`),
    apiFetch<{
      data: Array<{
        id: string;
        level: 'viewer' | 'editor';
        userId: string | null;
        roleId: string | null;
        userName: string | null;
        designation: string | null;
        roleName: string | null;
      }>;
      staff: Array<{
        userId: string;
        name: string;
        designation: string | null;
        code: string | null;
      }>;
      roles: Array<{ id: string; code: string; name: string }>;
    }>(`/engagement/consent-forms/${id}/shares`),
  ]);
  const taken = new Set(sh.data.map((x) => (x.userId ? `u:${x.userId}` : `r:${x.roleId}`)));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Consent forms', href: '/engagement/consent-forms' },
          { label: f.title, href: `/engagement/consent-forms/${id}` },
          { label: 'Share' },
        ]}
      />
      <PageHeader
        kicker="Consent form"
        title={`Share: ${f.title}`}
        description="Give staff or a role access to this form only. Those who manage consent forms always see every form."
      />
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? 'Done.') : sp.detail }} />

      <Card title="Add a person or a role" style={{ marginBottom: 'var(--sp-4)' }}>
        <form action={changeConsentShare} className="ep-filter-band" style={{ marginBottom: 0 }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value="add" />
          <label className="ep-field" htmlFor="sh-who" style={{ flex: '1 1 20rem' }}>
            <span className="ep-field__label">Staff member or role</span>
            <select id="sh-who" name="who" className="ep-select" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <optgroup label="Roles (everyone holding it)">
                {sh.roles
                  .filter((r) => !taken.has(`r:${r.id}`))
                  .map((r) => (
                    <option key={r.id} value={`r:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Staff">
                {sh.staff
                  .filter((x) => !taken.has(`u:${x.userId}`))
                  .map((x) => (
                    <option key={x.userId} value={`u:${x.userId}`}>
                      {x.name}
                      {x.code ? ` (${x.code})` : ''}
                      {x.designation ? ` · ${x.designation}` : ''}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <label className="ep-field" htmlFor="sh-level">
            <span className="ep-field__label">Access</span>
            <select
              id="sh-level"
              name="level"
              className="ep-select"
              defaultValue="viewer"
              data-native
            >
              <option value="viewer">View</option>
              <option value="editor">Edit</option>
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--primary">
            <Icon name="plus" size={16} />
            Share
          </button>
        </form>
        <ul
          className="ep-field__help"
          style={{ margin: 'var(--sp-3) 0 0', paddingLeft: 'var(--sp-5)' }}
        >
          <li>{LEVEL.viewer}.</li>
          <li>{LEVEL.editor}.</li>
          <li>
            Deleting, copying, connecting and sharing stay with those who manage consent forms.
          </li>
        </ul>
      </Card>

      <Card title={`Shared with (${sh.data.length})`}>
        {sh.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Not shared: only those who manage consent forms see it.
          </p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Shared with</caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Access</th>
                  <th scope="col">
                    <span className="ep-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sh.data.map((x) => {
                  const who = x.userId ? `u:${x.userId}` : `r:${x.roleId}`;
                  const name = x.userId ? (x.userName ?? 'Staff') : (x.roleName ?? 'Role');
                  return (
                    <tr key={x.id}>
                      <td>
                        {name} <Badge tone="neutral">{x.userId ? 'Staff' : 'Role'}</Badge>
                        {x.designation ? (
                          <span className="ep-field__help"> {x.designation}</span>
                        ) : null}
                      </td>
                      <td>
                        <form
                          action={changeConsentShare}
                          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
                        >
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="op" value="level" />
                          <input type="hidden" name="who" value={who} />
                          <label className="ep-field" htmlFor={`lv-${x.id}`} style={{ margin: 0 }}>
                            <span className="ep-sr-only">Access of {name}</span>
                            <select
                              id={`lv-${x.id}`}
                              name="level"
                              className="ep-select"
                              defaultValue={x.level}
                              data-native
                            >
                              <option value="viewer">View</option>
                              <option value="editor">Edit</option>
                            </select>
                          </label>
                          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                            <Icon name="check" size={16} />
                            Save
                          </button>
                        </form>
                      </td>
                      <td>
                        <form action={changeConsentShare}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="op" value="remove" />
                          <input type="hidden" name="who" value={who} />
                          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                            <Icon name="trash" size={16} />
                            Remove
                            <span className="ep-sr-only"> {name}</span>
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
