import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { VacancyForm } from '@/components/recruitment/VacancyForm';
import { VacancyShare } from '@/components/recruitment/VacancyShare';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  VACANCY_EVENT,
  VACANCY_STATUS,
  VACANCY_TONE,
  istInput,
  istText,
  type RecruitmentSetup,
  type VacancyApprovalStep,
  type VacancyPipeline,
  type VacancyView,
} from '@/lib/recruitment';
import {
  approveVacancy,
  cancelVacancy,
  closeVacancy,
  publishVacancy,
  sendBackVacancy,
  submitVacancy,
  updateVacancy,
} from '@/lib/recruitment-actions';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const STEP: Record<VacancyApprovalStep['status'], { text: string; tone: string }> = {
  pending: { text: 'Waits', tone: 'neutral' },
  approved: { text: 'Approved', tone: 'success' },
  rejected: { text: 'Sent back', tone: 'warning' },
  skipped: { text: 'Skipped', tone: 'neutral' },
};

/**
 * One vacancy: what it asks for, where its approval is, its public link once published, and the steps
 * the signed-in person may take. An approver without the recruitment rights sees it to decide on it.
 */
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
  const [v, me] = await Promise.all([
    apiFetch<VacancyView>(`/people/recruitment/vacancies/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    }),
    getMe(),
  ]);
  const setup = v.can.edit ? await apiFetch<RecruitmentSetup>('/people/recruitment/setup') : null;
  const pipe =
    v.can.view && ['approved', 'published', 'closed'].includes(v.status)
      ? await apiFetch<VacancyPipeline>(`/people/recruitment/vacancies/${id}/pipeline`)
      : null;
  // the date-and-time boxes take India time; the opening is not offered in the past
  const now = new Date().toISOString();
  const nowInput = istInput(now);
  const published = v.status === 'published';
  const openedAlready = published && v.opensAt !== null && v.opensAt <= now;
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
    [
      'Open on the careers page',
      v.opensAt ? `${istText(v.opensAt)} to ${istText(v.closesAt)}` : null,
    ],
    ['Raised by', v.raisedBy],
  ];
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ?? 'our school';
  return (
    <>
      <Breadcrumbs
        items={
          v.can.view
            ? [
                { label: 'Employee management', href: '/people/employees' },
                { label: 'Vacancies', href: '/people/recruitment' },
                { label: v.title },
              ]
            : [{ label: 'My approvals', href: '/approvals' }, { label: v.title }]
        }
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
        {v.can.approve ? (
          <p className="ep-alert ep-alert--info" role="status">
            This vacancy waits for your approval. Read the post below, then approve it or send it
            back with your reason.
          </p>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'end' }}>
          {v.can.approve ? (
            <>
              <ConfirmAction
                action={approveVacancy}
                fields={{ id: v.id }}
                label="Approve"
                variant="primary"
                title="Approve this vacancy?"
                confirmLabel="Approve"
              >
                It goes to the next approval level or, at the last level, is ready for the office to
                publish.
              </ConfirmAction>
              <ConfirmAction
                action={sendBackVacancy}
                fields={{ id: v.id, act: 'back' }}
                label="Send back"
                variant="secondary"
                title="Send this vacancy back?"
                confirmLabel="Send back"
                reason={{ label: 'Why it is sent back' }}
              >
                The person who raised it sees your reason, changes the vacancy and sends it again.
              </ConfirmAction>
            </>
          ) : null}
          {v.can.submit ? (
            <ConfirmAction
              action={submitVacancy}
              fields={{ id: v.id }}
              label="Send for approval"
              variant="primary"
              title="Send this vacancy for approval?"
              confirmLabel="Send"
            >
              It goes through the approval levels set in Recruitment set-up and shows in each
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
                <span className="ep-field__label">Open from (date and time)</span>
                <input
                  id="vp-from"
                  name="opensAt"
                  type="datetime-local"
                  className="ep-input"
                  required
                  min={openedAlready ? undefined : nowInput}
                  readOnly={openedAlready}
                  defaultValue={
                    v.opensAt && v.opensAt > now
                      ? istInput(v.opensAt)
                      : openedAlready
                        ? istInput(v.opensAt)
                        : nowInput
                  }
                />
              </label>
              <label className="ep-field" htmlFor="vp-to" style={{ margin: 0, minWidth: 0 }}>
                <span className="ep-field__label">Last date and time</span>
                <input
                  id="vp-to"
                  name="closesAt"
                  type="datetime-local"
                  className="ep-input"
                  required
                  min={nowInput}
                  defaultValue={v.closesAt && v.closesAt > now ? istInput(v.closesAt) : ''}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                {published
                  ? 'Change the dates'
                  : v.status === 'closed'
                    ? 'Publish again'
                    : 'Publish'}
              </button>
              <span className="ep-field__help" style={{ flexBasis: '100%' }}>
                India time. The careers page takes applications from the opening to the last date
                and time, then the vacancy closes by itself. Keep it open for an hour at least and a
                year at most.
              </span>
            </form>
          ) : null}
          {v.can.close ? (
            <ConfirmAction
              action={closeVacancy}
              fields={{ id: v.id, act: 'close' }}
              label="Close now"
              variant="secondary"
              title="Close this vacancy?"
              confirmLabel="Close"
              reason={{ label: 'Note' }}
            >
              It leaves the careers page; candidates who applied stay for screening.
            </ConfirmAction>
          ) : null}
          {v.can.cancel ? (
            <ConfirmAction
              action={cancelVacancy}
              fields={{ id: v.id, act: 'cancel' }}
              label="Cancel the vacancy"
              variant="ghost"
              title="Cancel this vacancy?"
              confirmLabel="Cancel the vacancy"
              reason={{ label: 'Why' }}
            >
              An approval under way is withdrawn. A cancelled vacancy is not published again.
            </ConfirmAction>
          ) : null}
        </div>
      </section>
      {v.share ? (
        <section className="ep-card ep-acr-card" aria-labelledby="vac-share-h">
          <h2 id="vac-share-h" className="ep-card__title">
            Public link and QR
          </h2>
          <VacancyShare
            url={v.share.url}
            qrSrc={`/api/vacancy-share?kind=qr&id=${v.id}`}
            qrSave={`/api/vacancy-share?kind=qr&id=${v.id}&save=1`}
            qrAlt={`QR code of the careers page of ${v.title}`}
            poster={{
              view: `/api/vacancy-share?kind=poster&id=${v.id}`,
              save: `/api/vacancy-share?kind=poster&id=${v.id}&save=1`,
            }}
            shareText={`${v.title} at ${school}. Apply by ${istText(v.closesAt)}:`}
            note={
              v.share.open
                ? `Takes applications until ${istText(v.closesAt)}.`
                : `The careers page shows it from ${istText(v.opensAt)}; the link works then.`
            }
          />
        </section>
      ) : null}
      {v.approval ? (
        <section className="ep-card ep-acr-card" aria-labelledby="vac-appr-h">
          <h2 id="vac-appr-h" className="ep-card__title">
            Approval
          </h2>
          <ol className="ep-acr-levels">
            {v.approval.steps.map((s) => (
              <li key={s.level} className="ep-acr-level">
                <span className="ep-acr-level__n" aria-hidden="true">
                  {s.level}
                </span>
                <div>
                  <strong>{s.name}</strong>{' '}
                  {s.current ? (
                    <Badge tone={s.overdue ? 'danger' : 'info'}>
                      {s.overdue ? 'Waiting, past its time' : 'Waiting now'}
                    </Badge>
                  ) : (
                    <Badge tone={STEP[s.status].tone as 'neutral'}>{STEP[s.status].text}</Badge>
                  )}
                  <div className="ep-field__help">
                    {s.people.length ? s.people.join(', ') : 'Nobody at this level'}
                    {s.actedBy && s.actedAt
                      ? ` · ${s.status === 'rejected' ? 'sent back' : 'approved'} by ${s.actedBy}, ${when(s.actedAt)}`
                      : ''}
                  </div>
                  {s.note ? <div className="ep-field__help">{s.note}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
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
