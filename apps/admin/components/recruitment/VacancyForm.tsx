import type { RecruitmentSetup, Vacancy } from '@/lib/recruitment';

/**
 * The vacancy form (new and edit): the post, where it sits, how many, what it asks for, and the screening
 * stages it uses (ticked from the school's list). Drop-downs come from Staff setup and are searchable.
 */
export function VacancyForm({
  setup,
  vacancy,
  action,
  submitLabel,
}: {
  setup: RecruitmentSetup;
  vacancy?: Vacancy;
  action: (fd: FormData) => void | Promise<void>;
  submitLabel: string;
}) {
  const v = vacancy;
  const stages = setup.stages.filter((s) => s.active || v?.stageIds.includes(s.id));
  const ticked = new Set(v ? v.stageIds : stages.map((s) => s.id));
  const pick = (
    name: string,
    label: string,
    options: string[],
    value: string | null | undefined,
  ) => (
    <label className="ep-field" htmlFor={`vf-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select id={`vf-${name}`} name={name} className="ep-select" defaultValue={value ?? ''}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    </label>
  );
  return (
    <form action={action} className="ep-card" style={{ padding: 'var(--sp-4)' }}>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <label className="ep-field" htmlFor="vf-title">
        <span className="ep-field__label">Post *</span>
        <input
          id="vf-title"
          name="title"
          className="ep-input"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. PGT Physics, Accountant"
          defaultValue={v?.title ?? ''}
        />
      </label>
      <div className="ep-grid-2">
        {pick('designation', 'Designation', setup.designations, v?.designation)}
        {pick('department', 'Department', setup.departments, v?.department)}
        {pick('subject', 'Subject (teaching posts)', setup.subjects, v?.subject)}
        {pick('employeeType', 'Employee type', setup.employeeTypes, v?.employeeType)}
        {setup.campuses.length > 1 ? (
          <label className="ep-field" htmlFor="vf-campus">
            <span className="ep-field__label">Campus</span>
            <select
              id="vf-campus"
              name="campusId"
              className="ep-select"
              defaultValue={v?.campusId ?? ''}
            >
              <option value="">Any</option>
              {setup.campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="vf-posts">
          <span className="ep-field__label">Number of posts *</span>
          <input
            id="vf-posts"
            name="posts"
            type="number"
            min={1}
            max={500}
            required
            className="ep-input"
            defaultValue={v?.posts ?? 1}
          />
        </label>
        <label className="ep-field" htmlFor="vf-pay">
          <span className="ep-field__label">Pay band / grade</span>
          <input
            id="vf-pay"
            name="payBand"
            className="ep-input"
            maxLength={120}
            defaultValue={v?.payBand ?? ''}
          />
        </label>
      </div>
      <label className="ep-field" htmlFor="vf-qual">
        <span className="ep-field__label">Qualifications needed</span>
        <textarea
          id="vf-qual"
          name="qualification"
          className="ep-input"
          rows={2}
          maxLength={1000}
          defaultValue={v?.qualification ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor="vf-exp">
        <span className="ep-field__label">Experience needed</span>
        <input
          id="vf-exp"
          name="experience"
          className="ep-input"
          maxLength={500}
          defaultValue={v?.experience ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor="vf-desc">
        <span className="ep-field__label">About the post (shown to candidates)</span>
        <textarea
          id="vf-desc"
          name="description"
          className="ep-input"
          rows={5}
          maxLength={5000}
          defaultValue={v?.description ?? ''}
        />
      </label>
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">Screening stages this vacancy uses *</legend>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          From the school’s list in Recruitment set-up, in that order. Untick a stage the post does
          not need, for example the demo class for an office post.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
          {stages.map((s) => (
            <label key={s.id} className="ep-check" htmlFor={`vf-st-${s.id}`}>
              <input
                id={`vf-st-${s.id}`}
                type="checkbox"
                name="stageIds"
                value={s.id}
                defaultChecked={ticked.has(s.id)}
              />{' '}
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="ep-btn ep-btn--primary">
        {submitLabel}
      </button>
    </form>
  );
}
