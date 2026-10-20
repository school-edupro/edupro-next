import { Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import {
  CAREERS_COOKIE,
  careersFetch,
  type CareerField,
  type CareerForm,
  type CareerMe,
  type CareerVacancy,
} from '@/lib/careers';
import { applyCareer, removeCareerDoc, saveCareerForm, uploadCareerDoc } from './actions';

const grid = {
  display: 'grid',
  gap: 'var(--sp-3)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
} as const;

const VIEW_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

/** One answer, drawn as the employee master's field type. */
function Field({ f, value }: { f: CareerField; value: unknown }) {
  const id = `cf-${f.key}`;
  const v = value === null || value === undefined ? '' : String(value);
  const label = (
    <span className="ep-field__label">
      {f.label}
      {f.required ? ' *' : ''}
    </span>
  );
  const help = f.help ? <span className="ep-field__help">{f.help}</span> : null;
  if (f.type === 'list' && f.options?.length)
    return (
      <label className="ep-field" htmlFor={id}>
        {label}
        <select id={id} name={`v.${f.key}`} className="ep-select" defaultValue={v}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {v && !f.options.includes(v) ? <option value={v}>{v}</option> : null}
        </select>
        {help}
      </label>
    );
  if (f.type === 'textarea')
    return (
      <label className="ep-field" htmlFor={id} style={{ gridColumn: '1 / -1' }}>
        {label}
        <textarea
          id={id}
          name={`v.${f.key}`}
          className="ep-input"
          rows={3}
          maxLength={2000}
          defaultValue={v}
        />
        {help}
      </label>
    );
  const type =
    f.type === 'date'
      ? 'date'
      : f.type === 'number'
        ? 'number'
        : f.type === 'email'
          ? 'email'
          : f.type === 'mobile'
            ? 'tel'
            : 'text';
  return (
    <label className="ep-field" htmlFor={id}>
      {label}
      <input
        id={id}
        name={`v.${f.key}`}
        type={type}
        className="ep-input"
        defaultValue={type === 'date' ? v.slice(0, 10) : v}
        maxLength={type === 'number' || type === 'date' ? undefined : 300}
        min={type === 'number' ? 0 : undefined}
        inputMode={
          f.type === 'mobile' || f.type === 'digits12' || f.type === 'pin' ? 'numeric' : undefined
        }
      />
      {help}
    </label>
  );
}

/** The application form on the careers page: answers, rows, interests, documents, then apply. */
export default async function CareerFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{
    apply?: string;
    ok?: string;
    warn?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const apply = sp.apply && /^\d{1,18}$/.test(sp.apply) ? sp.apply : '';
  const here = `/${school}/careers/form${apply ? `?apply=${apply}` : ''}`;
  const signedIn = Boolean((await cookies()).get(CAREERS_COOKIE)?.value);
  const me = signedIn ? await careersFetch<CareerMe>('/me').catch(() => null) : null;
  if (!me)
    return (
      <>
        <PageHeader kicker="Careers" title="Your application" />
        <Card title="Sign in">
          <CandidateSignIn school={school} returnTo={here} />
        </Card>
      </>
    );
  const [form, vacancy] = await Promise.all([
    careersFetch<CareerForm>(`/${school}/form`, {}, null),
    apply
      ? careersFetch<CareerVacancy>(`/${school}/vacancies/${apply}`, {}, null).catch(() => null)
      : null,
  ]);
  const applied = vacancy ? me.applications.find((a) => a.vacancyId === vacancy.id) : undefined;
  const hidden = (
    <>
      <input type="hidden" name="school" value={school} />
      <input type="hidden" name="apply" value={apply} />
    </>
  );
  return (
    <>
      <PageHeader
        kicker="Careers"
        title="Your application"
        description={
          vacancy
            ? `Applying for ${vacancy.title}. Fill the form once; it is used for every post you apply to.`
            : 'Fill it once; it is used for every post you apply to.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/careers/mine`}>
            My applications
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Not saved. {sp.detail}
        </div>
      ) : sp.warn ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Saved, except these answers (correct them and save again): {sp.detail}
        </div>
      ) : sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail ?? 'Saved.'}
        </div>
      ) : null}
      <form action={saveCareerForm} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {hidden}
        {form.sections.map((s) => (
          <Card key={s.id} title={s.title}>
            <div style={grid}>
              {form.fields
                .filter((f) => f.section === s.id)
                .map((f) => (
                  <Field key={f.key} f={f} value={me.values[f.key]} />
                ))}
            </div>
          </Card>
        ))}
        {Object.entries(form.rows).map(([kind, def]) => {
          const have = me.rows[kind] ?? [];
          const count = Math.min(def.max, have.length + 2);
          return (
            <Card key={kind} title={def.title}>
              <input type="hidden" name="rowKinds" value={kind} />
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`${def.title} (scrolls sideways)`}
              >
                <table className="ep-table">
                  <caption className="ep-sr-only">{def.title}</caption>
                  <thead>
                    <tr>
                      {def.columns.map((c) => (
                        <th key={c.key} scope="col">
                          {c.label}
                          {c.required ? ' *' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: count }, (_, i) => (
                      <tr key={i}>
                        {def.columns.map((c) => {
                          const val = have[i]?.[c.key] ?? '';
                          const name = `r.${kind}.${String(i)}.${c.key}`;
                          const aria = `${def.title} row ${String(i + 1)}, ${c.label}`;
                          return (
                            <td key={c.key}>
                              {c.type === 'list' ? (
                                <select
                                  name={name}
                                  className="ep-select"
                                  aria-label={aria}
                                  defaultValue={val}
                                >
                                  <option value="">—</option>
                                  {(c.options ?? []).map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  name={name}
                                  className="ep-input"
                                  aria-label={aria}
                                  type={c.type === 'date' ? 'date' : 'text'}
                                  inputMode={c.type === 'year' ? 'numeric' : undefined}
                                  maxLength={c.type === 'year' ? 4 : 300}
                                  defaultValue={val}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ep-field__help">
                Up to {def.max}. Save to get more empty rows; leave a row empty to drop it.
              </p>
            </Card>
          );
        })}
        <Card title="Interests">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
            {form.activities.map((a) => (
              <label key={a} className="ep-check">
                <input
                  type="checkbox"
                  name="act"
                  value={a}
                  defaultChecked={me.activities.includes(a)}
                />{' '}
                {a}
              </label>
            ))}
          </div>
        </Card>
        <div>
          <button type="submit" className="ep-btn ep-btn--primary">
            Save the form
          </button>
        </div>
      </form>

      <section id="docs" style={{ marginTop: 'var(--sp-4)' }}>
        <Card title="Photos and documents">
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Photos as JPG or PNG; documents as PDF or a photo; up to 5 MB each.
          </p>
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {form.documents.map((d) => {
              const have = me.files.filter((x) => x.kind === d.kind);
              return (
                <div
                  key={d.kind}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ minWidth: '12rem' }}>
                    {d.label}
                    {d.required ? ' *' : ''}
                  </strong>
                  {have.map((x, i) => (
                    <span key={x.id} className="ep-filelinks" style={{ alignItems: 'center' }}>
                      <a
                        href={`/api/careers/file/${x.fileId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ep-filelinks__btn"
                        aria-label={`View ${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                        title={`View ${d.label}`}
                      >
                        {VIEW_ICON}
                      </a>
                      <form action={removeCareerDoc} style={{ display: 'inline' }}>
                        {hidden}
                        <input type="hidden" name="id" value={x.id} />
                        <button
                          type="submit"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                        >
                          Remove
                        </button>
                      </form>
                    </span>
                  ))}
                  {d.many || !have.length ? (
                    <form
                      action={uploadCareerDoc}
                      style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                    >
                      {hidden}
                      <input type="hidden" name="kind" value={d.kind} />
                      <input
                        name="file"
                        type="file"
                        required
                        aria-label={`Choose ${d.label}`}
                        accept={
                          d.image
                            ? 'image/jpeg,image/png,image/webp'
                            : 'application/pdf,image/jpeg,image/png,image/webp'
                        }
                      />
                      <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                        Upload
                      </button>
                    </form>
                  ) : (
                    <form
                      action={uploadCareerDoc}
                      style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                    >
                      {hidden}
                      <input type="hidden" name="kind" value={d.kind} />
                      <input
                        name="file"
                        type="file"
                        required
                        aria-label={`Replace ${d.label}`}
                        accept={
                          d.image
                            ? 'image/jpeg,image/png,image/webp'
                            : 'application/pdf,image/jpeg,image/png,image/webp'
                        }
                      />
                      <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                        Replace
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {vacancy ? (
        <section id="apply" style={{ marginTop: 'var(--sp-4)' }}>
          <Card title={`Apply for ${vacancy.title}`}>
            {applied ? (
              <p style={{ margin: 0 }}>You have applied: application {applied.number}.</p>
            ) : me.missing.length ? (
              <p style={{ margin: 0 }}>Still needed before you apply: {me.missing.join(', ')}.</p>
            ) : (
              <form action={applyCareer} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                {hidden}
                <label className="ep-check">
                  <input type="checkbox" name="declaration" value="yes" required /> I declare that
                  the details given are true; a false statement may end my candidature or
                  employment.
                </label>
                <div>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Apply now
                  </button>
                </div>
              </form>
            )}
          </Card>
        </section>
      ) : null}
    </>
  );
}
