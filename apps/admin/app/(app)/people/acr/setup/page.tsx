import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AcrGradesEditor } from '@/components/acr/AcrGradesEditor';
import { AcrAssessorsEditor } from '@/components/acr/AcrAssessorsEditor';
import { AcrLevelsEditor } from '@/components/acr/AcrLevelsEditor';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { GROUP_LABEL, type AcrAssessors, type AcrQuestion, type AcrSetup } from '@/lib/acr';
import {
  importAcrAssessors,
  saveAcrCycle,
  saveAcrQuestion,
  toggleAcrQuestion,
} from '@/lib/acr-actions';

const TABS = [
  ['cycles', 'Cycles'],
  ['levels', 'Approval levels'],
  ['assessors', 'Assessors'],
  ['questions', 'Questions'],
  ['grades', 'Scale and grades'],
] as const;
type Tab = (typeof TABS)[number][0];

/** Employee ACR set-up (docs/design/32-employee-acr.md). */
export default async function AcrSetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    part?: string;
    group?: string;
    edit?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.acr.view')) notFound();
  const canEdit = me.permissions.includes('people.acr.manage');
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'cycles';
  const s = await apiFetch<AcrSetup>('/people/acr/setup');
  const assessors =
    tab === 'assessors' ? await apiFetch<AcrAssessors>('/people/acr/setup/assessors') : null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Employee ACR', href: '/people/acr' },
          { label: 'Set-up' },
        ]}
      />
      <PageHeader
        kicker="Employee ACR"
        title="ACR set-up"
        description="The yearly cycle and its dates, who assesses at each level, the questions, and how a score becomes a grade."
      />
      <Notice params={sp} />
      <nav
        className="ep-tabs-links"
        aria-label="ACR set-up"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {TABS.map(([k, label]) => (
          <a key={k} href={`?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>

      {tab === 'cycles' ? <Cycles s={s} sp={sp} canEdit={canEdit} today={today} /> : null}
      {tab === 'assessors' && assessors ? (
        <AcrAssessorsEditor
          data={assessors}
          staff={s.staff}
          canEdit={canEdit}
          importAction={importAcrAssessors}
        />
      ) : null}
      {tab === 'levels' ? (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {(['teaching', 'non_teaching'] as const).map((g) => (
            <AcrLevelsEditor
              key={g}
              group={g}
              title={`${GROUP_LABEL[g]} staff`}
              initial={s.levels[g]}
              roles={s.roles}
              designations={s.designations}
              staff={s.staff}
              canEdit={canEdit}
            />
          ))}
        </div>
      ) : null}
      {tab === 'questions' ? <Questions s={s} sp={sp} canEdit={canEdit} /> : null}
      {tab === 'grades' ? (
        <AcrGradesEditor
          scaleLabels={s.settings.scaleLabels}
          representationDays={s.settings.representationDays}
          staffLateAfter={s.settings.staffLateAfter}
          bands={s.bands}
          canEdit={canEdit}
        />
      ) : null}
    </>
  );
}

function Cycles({
  s,
  sp,
  canEdit,
  today,
}: {
  s: AcrSetup;
  sp: { edit?: string };
  canEdit: boolean;
  today: string;
}) {
  const editing = s.cycles.find((c) => c.id === sp.edit);
  const free = s.years.filter((y) => !s.cycles.some((c) => c.academicYearId === y.id));
  const tone = (st: string) =>
    st === 'open' ? 'success' : st === 'closed' ? 'neutral' : 'warning';
  return (
    <div className="ep-grid-2">
      <section className="ep-card" aria-labelledby="cycles-h" style={{ padding: 'var(--sp-4)' }}>
        <h2 id="cycles-h" className="ep-card__title">
          Cycles
        </h2>
        {s.cycles.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Cycle</th>
                  <th scope="col">Self-appraisal</th>
                  <th scope="col">Status</th>
                  <th scope="col">ACRs</th>
                  <th scope="col">
                    <span className="ep-sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.cycles.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="ep-field__help">{c.year}</div>
                    </td>
                    <td>
                      {dmy(c.selfFrom)} – {dmy(c.selfTo)}
                      {c.reviewBy ? (
                        <div className="ep-field__help">Reviews by {dmy(c.reviewBy)}</div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={tone(c.status)}>
                        {c.status === 'draft'
                          ? 'Not started'
                          : c.status === 'open'
                            ? 'Open'
                            : 'Closed'}
                      </Badge>
                    </td>
                    <td>{c.reports ? `${String(c.closed)} of ${String(c.reports)} final` : '—'}</td>
                    <td>
                      {canEdit && c.status !== 'closed' ? (
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`?tab=cycles&edit=${c.id}`}
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
          <p className="ep-field__help">No cycle yet. Add the first one for this year.</p>
        )}
        <p className="ep-field__help">
          Starting a cycle makes an ACR for every active employee; that is on the Employee ACR page.
        </p>
      </section>
      {canEdit && (editing || free.length) ? (
        <section
          className="ep-card"
          aria-labelledby="cycle-form-h"
          style={{ padding: 'var(--sp-4)' }}
        >
          <h2 id="cycle-form-h" className="ep-card__title">
            {editing ? `Change ${editing.name}` : 'Add a cycle'}
          </h2>
          <form action={saveAcrCycle}>
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            {editing ? (
              <input type="hidden" name="academicYearId" value={editing.academicYearId} />
            ) : (
              <label className="ep-field" htmlFor="cy-year">
                <span className="ep-field__label">Year *</span>
                <select id="cy-year" name="academicYearId" className="ep-select" required>
                  {free.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code} ({y.status})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="ep-field" htmlFor="cy-name">
              <span className="ep-field__label">Name *</span>
              <input
                id="cy-name"
                name="name"
                className="ep-input"
                required
                minLength={3}
                maxLength={80}
                defaultValue={editing?.name ?? `ACR ${free[0]?.code ?? ''}`.trim()}
              />
            </label>
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor="cy-from">
                <span className="ep-field__label">Self-appraisal from *</span>
                <input
                  id="cy-from"
                  name="selfFrom"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={editing?.selfFrom ?? today}
                />
              </label>
              <label className="ep-field" htmlFor="cy-to">
                <span className="ep-field__label">Self-appraisal to *</span>
                <input
                  id="cy-to"
                  name="selfTo"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={editing?.selfTo ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="cy-review">
                <span className="ep-field__label">Reviews done by</span>
                <input
                  id="cy-review"
                  name="reviewBy"
                  type="date"
                  className="ep-input"
                  defaultValue={editing?.reviewBy ?? ''}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                {editing ? 'Save' : 'Add cycle'}
              </button>
              {editing ? (
                <a className="ep-btn ep-btn--ghost" href="?tab=cycles">
                  Cancel
                </a>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Questions({
  s,
  sp,
  canEdit,
}: {
  s: AcrSetup;
  sp: { part?: string; group?: string; q?: string };
  canEdit: boolean;
}) {
  const part = sp.part === 'rate' ? 'rate' : 'self';
  const group = sp.group === 'non_teaching' ? 'non_teaching' : 'teaching';
  const list = s.questions.filter(
    (q) => q.part === part && (q.staffGroup === group || q.staffGroup === 'both'),
  );
  const sections = [...new Set(list.map((q) => q.section))];
  const editing = s.questions.find((q) => q.id === sp.q);
  const link = (p: string, g: string) => `?tab=questions&part=${p}&group=${g}`;
  const allSections = [...new Set(s.questions.map((q) => q.section))];
  return (
    <div className="ep-grid-2">
      <section className="ep-card" aria-labelledby="q-h" style={{ padding: 'var(--sp-4)' }}>
        <h2 id="q-h" className="ep-card__title">
          {part === 'self' ? 'Self-appraisal' : 'Rating by the levels'} · {GROUP_LABEL[group]}
        </h2>
        <nav
          className="ep-tabs-links"
          aria-label="Which form"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {(['self', 'rate'] as const).flatMap((p) =>
            (['teaching', 'non_teaching'] as const).map((g) => (
              <a
                key={`${p}-${g}`}
                href={link(p, g)}
                aria-current={p === part && g === group ? 'page' : undefined}
              >
                {p === 'self' ? 'Self' : 'Rating'} · {GROUP_LABEL[g]}
              </a>
            )),
          )}
        </nav>
        {sections.map((sec) => (
          <div key={sec} style={{ marginBottom: 'var(--sp-3)' }}>
            <h3 className="ep-field__label">{sec}</h3>
            <ul className="ep-acr-qs">
              {list
                .filter((q) => q.section === sec)
                .map((q) => (
                  <li key={q.id} className="ep-acr-q" data-off={q.active ? undefined : 'true'}>
                    <span>
                      {q.text}{' '}
                      <span className="ep-field__help">
                        {q.kind === 'scale' ? 'rating' : 'written'}
                        {q.weight !== 1 ? ` · weight ${String(q.weight)}` : ''}
                        {q.staffGroup === 'both' ? ' · both' : ''}
                        {q.required ? '' : ' · optional'}
                        {q.active ? '' : ' · switched off'}
                      </span>
                    </span>
                    {canEdit ? (
                      <span style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                        <a
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          href={`${link(part, group)}&q=${q.id}`}
                        >
                          Change
                        </a>
                        <form action={toggleAcrQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="part" value={part} />
                          <input type="hidden" name="active" value={q.active ? 'false' : 'true'} />
                          <input type="hidden" name="q" value={JSON.stringify(body(q))} />
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            {q.active ? 'Switch off' : 'Switch on'}
                          </button>
                        </form>
                      </span>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
      {canEdit ? (
        <section className="ep-card" aria-labelledby="qf-h" style={{ padding: 'var(--sp-4)' }}>
          <h2 id="qf-h" className="ep-card__title">
            {editing ? 'Change the question' : 'Add a question'}
          </h2>
          <form action={saveAcrQuestion}>
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor="qf-part">
                <span className="ep-field__label">Form *</span>
                <select
                  id="qf-part"
                  name="part"
                  className="ep-select"
                  defaultValue={editing?.part ?? part}
                >
                  <option value="self">Self-appraisal (the employee)</option>
                  <option value="rate">Rating (the levels)</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="qf-group">
                <span className="ep-field__label">For *</span>
                <select
                  id="qf-group"
                  name="staffGroup"
                  className="ep-select"
                  defaultValue={editing?.staffGroup ?? group}
                >
                  <option value="teaching">Teaching staff</option>
                  <option value="non_teaching">Non-teaching staff</option>
                  <option value="both">Both</option>
                </select>
              </label>
            </div>
            <label className="ep-field" htmlFor="qf-section">
              <span className="ep-field__label">Section *</span>
              <input
                id="qf-section"
                name="section"
                className="ep-input"
                list="qf-sections"
                required
                minLength={2}
                maxLength={80}
                defaultValue={editing?.section ?? ''}
              />
              <datalist id="qf-sections">
                {allSections.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
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
                defaultValue={editing?.text ?? ''}
              />
            </label>
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor="qf-kind">
                <span className="ep-field__label">Answer *</span>
                <select
                  id="qf-kind"
                  name="kind"
                  className="ep-select"
                  defaultValue={editing?.kind ?? 'scale'}
                >
                  <option value="scale">A rating on the scale</option>
                  <option value="text">Written</option>
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
                  defaultValue={editing?.weight ?? 1}
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
                  defaultValue={editing?.sortOrder ?? (list.length + 1) * 10}
                />
              </label>
            </div>
            <label className="ep-check" style={{ marginBottom: 'var(--sp-3)' }}>
              <input type="checkbox" name="required" defaultChecked={editing?.required ?? true} />{' '}
              Must be answered
            </label>
            {editing && !editing.active ? <input type="hidden" name="active" value="off" /> : null}
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                {editing ? 'Save' : 'Add question'}
              </button>
              {editing ? (
                <a className="ep-btn ep-btn--ghost" href={link(part, group)}>
                  Cancel
                </a>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

const body = (q: AcrQuestion) => ({
  part: q.part,
  staffGroup: q.staffGroup,
  section: q.section,
  text: q.text,
  kind: q.kind,
  weight: q.weight,
  required: q.required,
  sortOrder: q.sortOrder,
});
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
