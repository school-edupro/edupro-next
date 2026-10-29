import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveBankRemark, saveRemarkCategory } from '@/lib/remark-actions';
import type { ClassRow, Page, SubjectRow } from '@/lib/types';

interface Category {
  id: string;
  code: string;
  name: string;
  subjectId: string | null;
  subjectName: string | null;
  classIds: string[];
  freeText: boolean;
  sortOrder: number;
  status: string;
}
interface BankRemark {
  code: string;
  text: string;
  classId: string | null;
  classCode: string | null;
  sortOrder: number;
  categoryCode: string | null;
  status: string;
}

/**
 * Remark categories and the remark bank (docs/design/65, part 7): the old module's A / B / C / D
 * lists and "any other" text. A category may belong to a subject (its teacher writes it too), to some
 * classes, and may take free text or only its listed remarks. Remarks without a category are the
 * class teacher's general remark list.
 */
export default async function RemarkCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.master.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const [cats, bank, classes, subjects] = await Promise.all([
    apiFetch<{ data: Category[] }>('/exams/remark-categories').then((r) => r.data),
    apiFetch<{ data: BankRemark[] }>('/exams/remark-bank?all=1').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: SubjectRow[] }>('/academics/subjects?size=200')
      .then((r) => r.data)
      .catch(() => [] as SubjectRow[]),
  ]);
  const editing = cats.find((k) => k.code === sp.edit) ?? null;
  const classCode = (ids: string[]) =>
    ids.length
      ? ids.map((x) => classes.find((k) => k.id === x)?.code ?? x).join(', ')
      : 'Every class';
  const groups: Array<{ code: string | null; name: string }> = [
    { code: null, name: 'General remark (no category)' },
    ...cats.map((k) => ({ code: k.code, name: `${k.name} · ${k.code}` })),
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Remark categories' }]} />
      <PageHeader
        kicker="Exams"
        title="Remark categories and the remark bank"
        description="Each student gets one remark per category in an exam (written in the teacher app or on an exam's Remarks page); the report card prints them under the remarks."
      />
      <Notice params={sp} />
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card elevated title="Categories">
          {cats.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Categories">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Remark categories</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Classes</th>
                    <th scope="col">Takes</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Change</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((k) => (
                    <tr key={k.id}>
                      <td>{k.code}</td>
                      <td>{k.name}</td>
                      <td>{k.subjectName ?? '—'}</td>
                      <td>{classCode(k.classIds)}</td>
                      <td>{k.freeText ? 'Free text or the list' : 'The list only'}</td>
                      <td>
                        <Badge tone={k.status === 'active' ? 'success' : 'neutral'}>
                          {k.status === 'active' ? 'In use' : 'Not in use'}
                        </Badge>
                      </td>
                      <td>
                        {canManage ? (
                          <a
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            href={`/exams/remarks?edit=${k.code}`}
                          >
                            Change
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              No category yet: the class teacher writes one general remark.
            </p>
          )}
        </Card>
        {canManage ? (
          <Card elevated title={editing ? `Change ${editing.name}` : 'Add a category'}>
            <form action={saveRemarkCategory} key={editing?.code ?? 'new'}>
              <div className="ep-rp__row">
                <label className="ep-field">
                  <span className="ep-field__label">Code</span>
                  <input
                    className="ep-input"
                    name="code"
                    required
                    pattern="[A-Za-z0-9_\-]{1,12}"
                    defaultValue={editing?.code ?? ''}
                    readOnly={Boolean(editing)}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Name (printed on the card)</span>
                  <input
                    className="ep-input"
                    name="name"
                    required
                    minLength={2}
                    maxLength={60}
                    defaultValue={editing?.name ?? ''}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">A subject&rsquo;s remarks (optional)</span>
                  <select
                    className="ep-select"
                    name="subjectId"
                    defaultValue={editing?.subjectId ?? ''}
                  >
                    <option value="">None (the class teacher writes it)</option>
                    {subjects.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Classes (none ticked: every class)</legend>
                <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  {classes.map((k) => (
                    <label key={k.id} className="ep-check" htmlFor={`rc-k-${k.id}`}>
                      <input
                        id={`rc-k-${k.id}`}
                        className="ep-check__input"
                        type="checkbox"
                        name="classIds"
                        value={k.id}
                        defaultChecked={editing?.classIds.includes(k.id) ?? false}
                      />
                      <span className="ep-check__box" aria-hidden="true" /> {k.code}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="ep-rp__row">
                <label className="ep-check" htmlFor="rc-free">
                  <input
                    id="rc-free"
                    className="ep-check__input"
                    type="checkbox"
                    name="freeText"
                    defaultChecked={editing?.freeText ?? true}
                  />
                  <span className="ep-check__box" aria-hidden="true" /> Teachers may type their own
                  words (else only the listed remarks)
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Order</span>
                  <input
                    className="ep-input"
                    type="number"
                    name="sortOrder"
                    min={0}
                    max={1000}
                    defaultValue={editing?.sortOrder ?? cats.length + 1}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Status</span>
                  <select
                    className="ep-select"
                    name="status"
                    defaultValue={editing?.status ?? 'active'}
                  >
                    <option value="active">In use</option>
                    <option value="inactive">Not in use</option>
                  </select>
                </label>
              </div>
              <div className="ep-form-actions">
                <Button type="submit">{editing ? 'Save the category' : 'Add the category'}</Button>
              </div>
            </form>
          </Card>
        ) : null}
        <Card elevated title="The remark bank">
          {groups.map((g) => {
            const list = bank.filter((b) => b.categoryCode === g.code);
            return (
              <section key={g.code ?? '-'} style={{ marginBottom: 'var(--sp-3)' }}>
                <h3 className="ep-cdash__h3">{g.name}</h3>
                {list.length ? (
                  <ul style={{ marginTop: 0 }}>
                    {list.map((b) => (
                      <li key={b.code}>
                        <strong>{b.code}</strong> · {b.text}
                        {b.classCode ? ` · ${b.classCode} only` : ''}
                        {b.status !== 'active' ? ' · not in use' : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-field__help">None yet.</p>
                )}
              </section>
            );
          })}
          {canManage ? (
            <form action={saveBankRemark}>
              <h3 className="ep-cdash__h3">Add or change a remark (by its code)</h3>
              <div className="ep-rp__row">
                <label className="ep-field">
                  <span className="ep-field__label">Code</span>
                  <input className="ep-input" name="code" required pattern="[A-Za-z0-9_\-]{2,20}" />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Category</span>
                  <select className="ep-select" name="categoryCode" defaultValue="">
                    <option value="">General remark (no category)</option>
                    {cats.map((k) => (
                      <option key={k.code} value={k.code}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Class (optional)</span>
                  <select className="ep-select" name="classId" defaultValue="">
                    <option value="">Every class</option>
                    {classes.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="ep-field">
                <span className="ep-field__label">The remark</span>
                <textarea
                  className="ep-input"
                  name="text"
                  required
                  minLength={3}
                  maxLength={600}
                  rows={2}
                />
              </label>
              <div className="ep-rp__row">
                <label className="ep-field">
                  <span className="ep-field__label">Order</span>
                  <input
                    className="ep-input"
                    type="number"
                    name="sortOrder"
                    min={0}
                    max={1000}
                    defaultValue={0}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Status</span>
                  <select className="ep-select" name="status" defaultValue="active">
                    <option value="active">In use</option>
                    <option value="inactive">Not in use</option>
                  </select>
                </label>
              </div>
              <div className="ep-form-actions">
                <Button type="submit" variant="secondary">
                  Save the remark
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
