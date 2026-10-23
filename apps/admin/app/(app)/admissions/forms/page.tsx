import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import {
  copyAdmissionForm,
  createAdmissionForm,
  setAdmissionFormStatus,
} from '@/lib/admission-form-actions';
import type { FormListRow, FormMeta } from '@/lib/admission-forms';
import { apiFetch, getMe } from '@/lib/api';

/** Registration forms made in the form builder, each assigned to classes in an admission session. */
export default async function AdmissionFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.cycle.view')) notFound();
  const canManage = me.permissions.includes('admissions.cycle.manage');
  const [list, meta] = await Promise.all([
    apiFetch<{ data: FormListRow[] }>('/admissions/forms'),
    apiFetch<FormMeta>('/admissions/forms/meta'),
  ]);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Registration forms"
        description="Build the registration form for each class: tabs, fields, rules, uploads and where each answer goes in the student master. A form is given to classes in the admission session."
      />
      <Notice params={sp} />
      {canManage ? (
        <Card title="New form">
          <form action={createAdmissionForm} className="ep-adm-newform">
            <label className="ep-field">
              <span className="ep-field__label">Form name *</span>
              <input
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Registration 2027-28 (Class IX)"
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Start from</span>
              <select name="template" className="ep-select" defaultValue="general">
                {meta.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="blank">A blank form</option>
              </select>
            </label>
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary">
                Create and open the builder
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title={`Forms (${String(list.data.length)})`}>
        {list.data.length === 0 ? (
          <p className="ep-field__help">No forms yet. Create one from a ready form above.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Registration forms">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Form</th>
                  <th scope="col">Tabs</th>
                  <th scope="col">Fields</th>
                  <th scope="col">Used by classes</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={`/admissions/forms/${f.id}`}>
                        <strong>{f.name}</strong>
                      </a>
                      {f.description ? <div className="ep-field__help">{f.description}</div> : null}
                    </td>
                    <td>{f.steps}</td>
                    <td>{f.fields}</td>
                    <td>{f.classes}</td>
                    <td>
                      <Badge tone={f.status === 'active' ? 'success' : 'neutral'}>
                        {f.status === 'active' ? 'Active' : 'Archived'}
                      </Badge>
                    </td>
                    <td>
                      {canManage ? (
                        <div className="ep-adm-rowactions">
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/admissions/forms/${f.id}`}
                          >
                            Open builder
                          </a>
                          <form action={copyAdmissionForm} className="ep-adm-inline">
                            <input type="hidden" name="id" value={f.id} />
                            <input
                              type="hidden"
                              name="name"
                              value={`${f.name} (copy)`.slice(0, 120)}
                            />
                            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                              Copy
                            </button>
                          </form>
                          <form action={setAdmissionFormStatus} className="ep-adm-inline">
                            <input type="hidden" name="id" value={f.id} />
                            <input
                              type="hidden"
                              name="to"
                              value={f.status === 'active' ? 'archive' : 'restore'}
                            />
                            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                              {f.status === 'active' ? 'Archive' : 'Restore'}
                            </button>
                          </form>
                        </div>
                      ) : (
                        <a href={`/admissions/forms/${f.id}`}>View</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
