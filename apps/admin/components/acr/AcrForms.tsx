import { Badge } from '@edupro/ui';
import {
  copyAcrForm,
  removeAcrSection,
  saveAcrForm,
  saveAcrQuestion,
  saveAcrSection,
  toggleAcrQuestion,
} from '@/lib/acr-actions';
import { GROUP_LABEL, type AcrForm, type AcrQuestion, type AcrSetup } from '@/lib/acr';

const PART_LABEL = { self: 'Self-appraisal', level: 'Level questionnaire' } as const;
const FOR_LABEL = {
  teaching: 'Teaching staff',
  non_teaching: 'Non-teaching staff',
  both: 'All staff',
} as const;
const KIND_LABEL = { scale: 'rating', text: 'written', yesno: 'yes / no' } as const;
const qBody = (q: AcrQuestion) => ({
  formId: q.formId,
  sectionId: q.sectionId,
  text: q.text,
  kind: q.kind,
  weight: q.weight,
  required: q.required,
  sortOrder: q.sortOrder,
  active: q.active,
});

/**
 * Forms and questions (0191, docs/design/32-employee-acr.md): the self-appraisal forms per staff
 * category and the questionnaire of each approval level, each a list of sections (title, help,
 * weight) holding questions (a rating on the scale, written, or yes / no). Add a form, copy one as the
 * start of another, switch one off; add and move sections and questions.
 */
export function AcrForms({
  s,
  sp,
  canEdit,
}: {
  s: AcrSetup;
  sp: { form?: string; q?: string; section?: string };
  canEdit: boolean;
}) {
  const form = s.forms.find((f) => f.id === sp.form);
  if (form) return <FormDetail s={s} form={form} sp={sp} canEdit={canEdit} />;
  const link = (id: string) => `?tab=questions&form=${id}`;
  const groups: Array<['self' | 'level', string]> = [
    ['self', 'Self-appraisal forms (one per staff category)'],
    ['level', 'Questionnaires of the approval levels'],
  ];
  const usedBy = (f: AcrForm) =>
    (['teaching', 'non_teaching'] as const).flatMap((g) =>
      s.levels[g].filter((l) => l.formId === f.id).map((l) => `${l.label} (${GROUP_LABEL[g]})`),
    );
  return (
    <div className="ep-grid-2">
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {groups.map(([part, title]) => (
          <section
            key={part}
            className="ep-card"
            aria-labelledby={`forms-${part}-h`}
            style={{ padding: 'var(--sp-4)' }}
          >
            <h2 id={`forms-${part}-h`} className="ep-card__title">
              {title}
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {part === 'self'
                ? 'Each employee fills the first active form for their category (teaching or non-teaching; a form for all staff serves both).'
                : 'Each approval level names the questionnaire it answers under Approval levels; a level with none gives the grade and remarks only.'}
            </p>
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Form</th>
                    <th scope="col">For</th>
                    <th scope="col">Sections · questions</th>
                    <th scope="col">{part === 'level' ? 'Used by' : 'Status'}</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.forms
                    .filter((f) => f.part === part)
                    .map((f) => {
                      const n = f.sections.reduce(
                        (k, x) => k + x.questions.filter((q) => q.active).length,
                        0,
                      );
                      const used = usedBy(f);
                      return (
                        <tr key={f.id} data-off={f.active ? undefined : 'true'}>
                          <td>
                            <a href={link(f.id)}>
                              <strong>{f.name}</strong>
                            </a>
                            {f.description ? (
                              <div className="ep-field__help">{f.description}</div>
                            ) : null}
                          </td>
                          <td>{FOR_LABEL[f.staffGroup]}</td>
                          <td>
                            {f.sections.length} · {n}
                          </td>
                          <td>
                            {!f.active ? (
                              <Badge tone="neutral">Switched off</Badge>
                            ) : part === 'level' ? (
                              used.length ? (
                                used.join(', ')
                              ) : (
                                <span className="ep-field__help">No level yet</span>
                              )
                            ) : (
                              <Badge tone="success">In use</Badge>
                            )}
                          </td>
                          <td>
                            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(f.id)}>
                              Open
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  {!s.forms.some((f) => f.part === part) ? (
                    <tr>
                      <td colSpan={5} className="ep-field__help">
                        None yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {canEdit ? (
        <section className="ep-card" aria-labelledby="nf-h" style={{ padding: 'var(--sp-4)' }}>
          <h2 id="nf-h" className="ep-card__title">
            Add a form
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A self-appraisal for a staff category, or a questionnaire for one approval level (for
            example “L2 · Teaching” or “Principal · Non-teaching”). To start from an existing form,
            open it and use Copy.
          </p>
          <form action={saveAcrForm}>
            <label className="ep-field" htmlFor="nf-name">
              <span className="ep-field__label">Name *</span>
              <input
                id="nf-name"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. L1 questionnaire · Teaching"
              />
            </label>
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor="nf-part">
                <span className="ep-field__label">Kind *</span>
                <select id="nf-part" name="part" className="ep-select" defaultValue="level">
                  <option value="self">Self-appraisal (the employee)</option>
                  <option value="level">Questionnaire of an approval level</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="nf-group">
                <span className="ep-field__label">For *</span>
                <select
                  id="nf-group"
                  name="staffGroup"
                  className="ep-select"
                  defaultValue="teaching"
                >
                  <option value="teaching">Teaching staff</option>
                  <option value="non_teaching">Non-teaching staff</option>
                  <option value="both">All staff</option>
                </select>
              </label>
            </div>
            <label className="ep-field" htmlFor="nf-desc">
              <span className="ep-field__label">Description (shown on the sheet)</span>
              <input id="nf-desc" name="description" className="ep-input" maxLength={500} />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary">
              Add form
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function FormDetail({
  s,
  form,
  sp,
  canEdit,
}: {
  s: AcrSetup;
  form: AcrForm;
  sp: { form?: string; q?: string; section?: string };
  canEdit: boolean;
}) {
  const back = `?tab=questions&form=${form.id}`;
  const editingQ = form.sections.flatMap((x) => x.questions).find((q) => q.id === sp.q);
  const editingS = form.sections.find((x) => x.id === sp.section);
  const sections = [...form.sections].sort(
    (a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id),
  );
  const total = sections.reduce((k, x) => k + x.questions.filter((q) => q.active).length, 0);
  const usedBy = (['teaching', 'non_teaching'] as const).flatMap((g) =>
    s.levels[g].filter((l) => l.formId === form.id).map((l) => `${l.label} (${GROUP_LABEL[g]})`),
  );
  const hidden = (q: AcrQuestion, extra: Record<string, string>) => (
    <>
      <input type="hidden" name="id" value={q.id} />
      <input type="hidden" name="formId" value={form.id} />
      <input type="hidden" name="q" value={JSON.stringify(qBody(q))} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
  return (
    <div className="ep-grid-2">
      <section className="ep-card" aria-labelledby="fd-h" style={{ padding: 'var(--sp-4)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
          }}
        >
          <h2 id="fd-h" className="ep-card__title" style={{ margin: 0 }}>
            {form.name}
          </h2>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="?tab=questions">
            All forms
          </a>
        </div>
        <p className="ep-field__help">
          {PART_LABEL[form.part]} · {FOR_LABEL[form.staffGroup]} · {sections.length} sections ·{' '}
          {total} questions
          {form.part === 'level'
            ? ` · ${usedBy.length ? `used by ${usedBy.join(', ')}` : 'no level uses it yet'}`
            : ''}
          {!form.active ? ' · switched off' : ''}
        </p>
        {form.description ? <p>{form.description}</p> : null}
        {sections.map((sec, i) => {
          const qs = [...sec.questions].sort(
            (a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id),
          );
          return (
            <div key={sec.id} style={{ marginBottom: 'var(--sp-4)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                }}
              >
                <h3 className="ep-field__label" style={{ margin: 0 }}>
                  {i + 1}. {sec.title}
                  <span className="ep-field__help">
                    {sec.weight !== 1 ? ` · weight ${String(sec.weight)}` : ''}
                    {sec.help ? ` · ${sec.help}` : ''}
                  </span>
                </h3>
                {canEdit ? (
                  <span style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                    {i > 0 ? (
                      <form action={saveAcrSection}>
                        <input type="hidden" name="id" value={sec.id} />
                        <input type="hidden" name="formId" value={form.id} />
                        <input type="hidden" name="title" value={sec.title} />
                        <input type="hidden" name="help" value={sec.help ?? ''} />
                        <input type="hidden" name="weight" value={sec.weight} />
                        <input
                          type="hidden"
                          name="sortOrder"
                          value={sections[i - 1]!.sortOrder - 1}
                        />
                        <button
                          type="submit"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${sec.title} up`}
                        >
                          ↑
                        </button>
                      </form>
                    ) : null}
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`${back}&section=${sec.id}`}
                    >
                      Change section
                    </a>
                    {!qs.length ? (
                      <form action={removeAcrSection}>
                        <input type="hidden" name="id" value={sec.id} />
                        <input type="hidden" name="formId" value={form.id} />
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {qs.length ? (
                <ul className="ep-acr-qs">
                  {qs.map((q, j) => (
                    <li key={q.id} className="ep-acr-q" data-off={q.active ? undefined : 'true'}>
                      <span>
                        {q.text}{' '}
                        <span className="ep-field__help">
                          {KIND_LABEL[q.kind]}
                          {q.weight !== 1 ? ` · weight ${String(q.weight)}` : ''}
                          {q.required ? '' : ' · optional'}
                          {q.active ? '' : ' · switched off'}
                        </span>
                      </span>
                      {canEdit ? (
                        <span style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                          {j > 0 ? (
                            <form action={toggleAcrQuestion}>
                              {hidden(q, { sortOrder: String(qs[j - 1]!.sortOrder - 1) })}
                              <button
                                type="submit"
                                className="ep-btn ep-btn--ghost ep-btn--sm"
                                aria-label={`Move “${q.text}” up`}
                              >
                                ↑
                              </button>
                            </form>
                          ) : null}
                          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${back}&q=${q.id}`}>
                            Change
                          </a>
                          <form action={toggleAcrQuestion}>
                            {hidden(q, { active: q.active ? 'false' : 'true' })}
                            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                              {q.active ? 'Switch off' : 'Switch on'}
                            </button>
                          </form>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">No question yet.</p>
              )}
            </div>
          );
        })}
        {!sections.length ? (
          <p className="ep-field__help">
            No section yet: add one on the right, then its questions.
          </p>
        ) : null}
      </section>
      {canEdit ? (
        <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
          {editingS || !sections.length || sp.section === 'new' ? (
            <section className="ep-card" aria-labelledby="sf-h" style={{ padding: 'var(--sp-4)' }}>
              <h2 id="sf-h" className="ep-card__title">
                {editingS ? 'Change the section' : 'Add a section'}
              </h2>
              <form action={saveAcrSection}>
                <input type="hidden" name="id" value={editingS?.id ?? ''} />
                <input type="hidden" name="formId" value={form.id} />
                <label className="ep-field" htmlFor="sf-title">
                  <span className="ep-field__label">Title *</span>
                  <input
                    id="sf-title"
                    name="title"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={editingS?.title ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="sf-help">
                  <span className="ep-field__label">Help shown under the title</span>
                  <input
                    id="sf-help"
                    name="help"
                    className="ep-input"
                    maxLength={500}
                    defaultValue={editingS?.help ?? ''}
                  />
                </label>
                <div className="ep-fit-row">
                  <label className="ep-field" htmlFor="sf-weight">
                    <span className="ep-field__label">Weight in the score</span>
                    <input
                      id="sf-weight"
                      name="weight"
                      type="number"
                      step="0.25"
                      min={0.25}
                      max={10}
                      className="ep-input"
                      defaultValue={editingS?.weight ?? 1}
                    />
                  </label>
                  <label className="ep-field" htmlFor="sf-order">
                    <span className="ep-field__label">Order</span>
                    <input
                      id="sf-order"
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={9999}
                      className="ep-input"
                      defaultValue={editingS?.sortOrder ?? (sections.length + 1) * 10}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    {editingS ? 'Save' : 'Add section'}
                  </button>
                  {editingS || sp.section === 'new' ? (
                    <a className="ep-btn ep-btn--ghost" href={back}>
                      Cancel
                    </a>
                  ) : null}
                </div>
              </form>
            </section>
          ) : (
            <p style={{ margin: 0 }}>
              <a className="ep-btn ep-btn--secondary" href={`${back}&section=new`}>
                Add a section
              </a>
            </p>
          )}
          {sections.length ? (
            <section className="ep-card" aria-labelledby="qf-h" style={{ padding: 'var(--sp-4)' }}>
              <h2 id="qf-h" className="ep-card__title">
                {editingQ ? 'Change the question' : 'Add a question'}
              </h2>
              <form action={saveAcrQuestion}>
                <input type="hidden" name="id" value={editingQ?.id ?? ''} />
                <input type="hidden" name="formId" value={form.id} />
                <label className="ep-field" htmlFor="qf-section">
                  <span className="ep-field__label">Section *</span>
                  <select
                    id="qf-section"
                    name="sectionId"
                    className="ep-select"
                    defaultValue={editingQ?.sectionId ?? sections[sections.length - 1]!.id}
                  >
                    {sections.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="qf-text">
                  <span className="ep-field__label">Question *</span>
                  <input
                    id="qf-text"
                    name="text"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    defaultValue={editingQ?.text ?? ''}
                  />
                </label>
                <div className="ep-fit-row">
                  <label className="ep-field" htmlFor="qf-kind">
                    <span className="ep-field__label">Answer *</span>
                    <select
                      id="qf-kind"
                      name="kind"
                      className="ep-select"
                      defaultValue={editingQ?.kind ?? 'scale'}
                    >
                      <option value="scale">A rating on the scale</option>
                      <option value="text">Written</option>
                      <option value="yesno">Yes or no</option>
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="qf-weight">
                    <span className="ep-field__label">Weight</span>
                    <input
                      id="qf-weight"
                      name="weight"
                      type="number"
                      step="0.25"
                      min={0.25}
                      max={10}
                      className="ep-input"
                      defaultValue={editingQ?.weight ?? 1}
                    />
                  </label>
                  <label className="ep-field" htmlFor="qf-order">
                    <span className="ep-field__label">Order</span>
                    <input
                      id="qf-order"
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={9999}
                      className="ep-input"
                      defaultValue={editingQ?.sortOrder ?? (total + 1) * 10}
                    />
                  </label>
                </div>
                <label className="ep-check" style={{ marginBottom: 'var(--sp-3)' }}>
                  <input
                    type="checkbox"
                    name="required"
                    defaultChecked={editingQ?.required ?? true}
                  />{' '}
                  Must be answered
                </label>
                {editingQ && !editingQ.active ? (
                  <input type="hidden" name="active" value="off" />
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    {editingQ ? 'Save' : 'Add question'}
                  </button>
                  {editingQ ? (
                    <a className="ep-btn ep-btn--ghost" href={back}>
                      Cancel
                    </a>
                  ) : null}
                </div>
              </form>
            </section>
          ) : null}
          <section className="ep-card" aria-labelledby="ff-h" style={{ padding: 'var(--sp-4)' }}>
            <h2 id="ff-h" className="ep-card__title">
              The form
            </h2>
            <form action={saveAcrForm}>
              <input type="hidden" name="id" value={form.id} />
              <input type="hidden" name="part" value={form.part} />
              <input type="hidden" name="sortOrder" value={form.sortOrder} />
              <input type="hidden" name="active" value={form.active ? 'true' : 'false'} />
              <label className="ep-field" htmlFor="ff-name">
                <span className="ep-field__label">Name *</span>
                <input
                  id="ff-name"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={form.name}
                />
              </label>
              <label className="ep-field" htmlFor="ff-group">
                <span className="ep-field__label">For *</span>
                <select
                  id="ff-group"
                  name="staffGroup"
                  className="ep-select"
                  defaultValue={form.staffGroup}
                >
                  <option value="teaching">Teaching staff</option>
                  <option value="non_teaching">Non-teaching staff</option>
                  <option value="both">All staff</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="ff-desc">
                <span className="ep-field__label">Description (shown on the sheet)</span>
                <input
                  id="ff-desc"
                  name="description"
                  className="ep-input"
                  maxLength={500}
                  defaultValue={form.description ?? ''}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Save the form
              </button>
            </form>
            <form action={saveAcrForm} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={form.id} />
              <input type="hidden" name="part" value={form.part} />
              <input type="hidden" name="name" value={form.name} />
              <input type="hidden" name="staffGroup" value={form.staffGroup} />
              <input type="hidden" name="description" value={form.description ?? ''} />
              <input type="hidden" name="sortOrder" value={form.sortOrder} />
              <input type="hidden" name="active" value={form.active ? 'false' : 'true'} />
              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                {form.active ? 'Switch the form off' : 'Switch the form on'}
              </button>
            </form>
            <form
              action={copyAcrForm}
              style={{ marginTop: 'var(--sp-3)', display: 'grid', gap: 'var(--sp-2)' }}
            >
              <input type="hidden" name="id" value={form.id} />
              <label className="ep-field" htmlFor="cf-name" style={{ margin: 0 }}>
                <span className="ep-field__label">Copy as</span>
                <input
                  id="cf-name"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder={`${form.name} (copy)`}
                />
              </label>
              <label className="ep-field" htmlFor="cf-group" style={{ margin: 0 }}>
                <span className="ep-field__label">For</span>
                <select
                  id="cf-group"
                  name="staffGroup"
                  className="ep-select"
                  defaultValue={form.staffGroup}
                >
                  <option value="teaching">Teaching staff</option>
                  <option value="non_teaching">Non-teaching staff</option>
                  <option value="both">All staff</option>
                </select>
              </label>
              <div>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Copy the form
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
