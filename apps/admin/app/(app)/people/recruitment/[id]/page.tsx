import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { VacancyForm } from '@/components/recruitment/VacancyForm';
import { ApiError, apiFetch } from '@/lib/api';
import {
  VACANCY_EVENT,
  VACANCY_STATUS,
  VACANCY_TONE,
  dmy,
  type RecruitmentSetup,
  type VacancyPipeline,
  type VacancyView,
} from '@/lib/recruitment';
import {
  cancelVacancy,
  closeVacancy,
  publishVacancy,
  submitVacancy,
  updateVacancy,
} from '@/lib/recruitment-actions';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One vacancy: what it asks for, where it is, and the steps the signed-in person may take. */
export default async function VacancyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const v = await apiFetch<VacancyView>(`/people/recruitment/vacancies/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    },
  );
  const setup = v.can.edit ? await apiFetch<RecruitmentSetup>('/people/recruitment/setup') : null;
  const pipe = ['approved', 'published', 'closed'].includes(v.status)
    ? await apiFetch<VacancyPipeline>(`/people/recruitment/vacancies/${id}/pipeline`)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const facts: Array<[string, string | null]> = [
    ['Code', v.code],
    ['Designation', v.designation],
    ['Department', v.department],
    ['Subject', v.subject],
    ['Employee type', v.employeeType],
    ['Campus', v.campus],
    ['Number of posts', String(v.posts)],
    ['Pay band / grade', v.payBand],
    ['Qualifications needed', v.qualification],
    ['Experience needed', v.experience],
    ['Screening stages', v.stages.join(' → ')],
    ['Open on the careers page', v.opensOn ? `${dmy(v.opensOn)} to ${dmy(v.closesOn)}` : null],
    ['Raised by', v.raisedBy],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Vacancies', href: '/people/recruitment' },
          { label: v.title },
        ]}
      />
      <PageHeader
        kicker={`Vacancy ${v.code}`}
        title={v.title}
        description={v.department ?? undefined}
      />
      <Notice params={sp} />
      <section className="ep-card ep-acr-card" aria-labelledby="vac-state-h">
        <h2 id="vac-state-h" className="ep-card__title">
          <Badge tone={VACANCY_TONE[v.status] as 'neutral'}>{VACANCY_STATUS[v.status]}</Badge>{' '}
          {v.status === 'pending' && v.waitingWith ? (
            <span className="ep-field__help">Waiting with {v.waitingWith}</span>
          ) : null}
        </h2>
        {v.status === 'rejected' && v.decisionNote ? (
          <p className="ep-alert ep-alert--warning" role="status">
            Sent back: {v.decisionNote}
          </p>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'end' }}>
          {v.can.submit ? (
            <ConfirmAction
              action={submitVacancy}
              fields={{ id: v.id }}
              label="Send for approval"
              variant="primary"
              title="Send this vacancy for approval?"
              confirmLabel="Send"
            >
              It goes through the approval levels the school set under Workflow and shows in each
              approver’s header approvals. It cannot be changed while it waits.
            </ConfirmAction>
          ) : null}
          {v.can.publish ? (
            <form
              action={publishVacancy}
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end', flexWrap: 'wrap' }}
            >
              <input type="hidden" name="id" value={v.id} />
              <label className="ep-field" htmlFor="vp-from" style={{ margin: 0, minWidth: 0 }}>
                <span className="ep-field__label">Open from</span>
                <input
                  id="vp-from"
                  name="opensOn"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={v.opensOn ?? today}
                />
              </label>
              <label className="ep-field" htmlFor="vp-to" style={{ margin: 0, minWidth: 0 }}>
                <span className="ep-field__label">Last date</span>
                <input
                  id="vp-to"
                  name="closesOn"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={v.closesOn ?? ''}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                {v.status === 'closed' ? 'Publish again' : 'Publish'}
              </button>
            </form>
          ) : null}
          {v.can.close ? (
            <ConfirmAction
              action={closeVacancy}
              fields={{ id: v.id }}
              label="Close"
              variant="secondary"
              title="Close this vacancy?"
              confirmLabel="Close"
              reason={{ label: 'Note (optional)' }}
            >
              It leaves the careers page; candidates who applied stay for screening.
            </ConfirmAction>
          ) : null}
          {v.can.cancel ? (
            <ConfirmAction
              action={cancelVacancy}
              fields={{ id: v.id }}
              label="Cancel the vacancy"
              variant="ghost"
              title="Cancel this vacancy?"
              confirmLabel="Cancel the vacancy"
              reason={{ label: 'Why (optional)' }}
            >
              An approval under way is withdrawn. A cancelled vacancy is not published again.
            </ConfirmAction>
          ) : null}
        </div>
      </section>
      {pipe ? (
        <section className="ep-card ep-acr-card" aria-labelledby="vac-cand-h">
          <h2 id="vac-cand-h" className="ep-card__title">
            Candidates · {pipe.total}{' '}
            <span className="ep-field__help">
              Selected {pipe.selected} of {pipe.posts} post{pipe.posts > 1 ? 's' : ''}
              {pipe.onHold ? ` · ${String(pipe.onHold)} on hold` : ''}
              {pipe.rejected ? ` · ${String(pipe.rejected)} not taken forward` : ''}
            </span>
          </h2>
          <div className="ep-dash-kpis">
            {pipe.stages.map((st) => (
              <a
                key={st.id}
                className="ep-card ep-card--elevated ep-staff-kpi"
                href={`/people/recruitment/candidates?vacancy=${v.id}&stage=${st.id}`}
              >
                <span className="ep-kpi__value">{st.open}</span>
                <span className="ep-kpi__label">At {st.name}</span>
              </a>
            ))}
          </div>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/people/recruitment/candidates?vacancy=${v.id}`}
          >
            Open the candidates
          </a>
        </section>
      ) : null}
      <div className="ep-grid-2">
        <section className="ep-card ep-acr-card" aria-labelledby="vac-facts-h">
          <h2 id="vac-facts-h" className="ep-card__title">
            The post
          </h2>
          <dl className="ep-hero__facts">
            {facts.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val ?? '—'}</dd>
              </div>
            ))}
          </dl>
          {v.description ? (
            <>
              <h3 className="ep-field__label">About the post</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{v.description}</p>
            </>
          ) : null}
        </section>
        <section className="ep-card ep-acr-card" aria-labelledby="vac-steps-h">
          <h2 id="vac-steps-h" className="ep-card__title">
            Steps
          </h2>
          <ol>
            {v.events.map((e, i) => (
              <li key={i}>
                <strong>{VACANCY_EVENT[e.what] ?? e.what}</strong> · {when(e.at)}
                {e.by_name ? ` · ${e.by_name}` : ''}
                {e.note ? <div className="ep-field__help">{e.note}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
      {setup ? (
        <section aria-labelledby="vac-edit-h" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="vac-edit-h" className="ep-card__title">
            Change the vacancy
          </h2>
          <VacancyForm setup={setup} vacancy={v} action={updateVacancy} submitLabel="Save" />
        </section>
      ) : null}
    </>
  );
}
