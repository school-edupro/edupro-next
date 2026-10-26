import { Badge, Card, LAYOUT_TYPES, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApplicationCorrect, type AnswerChange } from '@/components/admissions/ApplicationCorrect';
import { DeskForm } from '@/components/admissions/DeskForm';
import { RegistrationActions } from '@/components/admissions/RegistrationActions';
import { RegistrationOffice } from '@/components/admissions/RegistrationOffice';
import { RegistrationPointsCheck } from '@/components/admissions/RegistrationPointsCheck';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { Notice } from '@/components/Notice';
import { REG_STATUS, dmy, rupees, type RegistrationForm } from '@/lib/admission-desk';
import { whenIst, type JourneyStep, type SlotInfo } from '@/lib/admission-process';
import type { RegistrationPoints } from '@/lib/admission-setup';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { STATUS_LABEL, STATUS_TONE, type Ticket } from '@/lib/helpdesk';

interface Detail extends RegistrationForm {
  process: {
    steps: JourneyStep[];
    stageNo: number;
    levelNo: number;
    current: {
      stageId: string;
      name: string;
      kind: 'document_check' | 'test' | 'interview' | 'interaction' | 'selection' | 'custom';
      maxMarks: number | null;
      level: number;
      levels: number;
      levelName: string;
      last: boolean;
    } | null;
    canAct: boolean;
    undoable: boolean;
    hasProcess: boolean;
  };
  categoryId: string | null;
  categories: Array<{ id: string; name: string }>;
  merit: number | null;
  points: RegistrationPoints | null;
  waitRank: number | null;
  offer: { offeredAt: string; expiresAt: string | null; admissionFee: number } | null;
  slot: SlotInfo | null;
  corrections: Array<{
    id: string;
    fields: string[];
    remark: string;
    dueOn: string | null;
    status: string;
    at: string;
    resubmittedAt: string | null;
    by: string | null;
  }>;
  events: Array<{
    id: string;
    status: string;
    note: string | null;
    actor: string | null;
    at: string;
  }>;
  answerChanges: AnswerChange[];
  canCorrect: boolean;
}

const DECISION: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'info' }> =
  {
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Not selected', tone: 'danger' },
    hold: { label: 'On hold', tone: 'warning' },
    offered: { label: 'Offered', tone: 'success' },
    waitlisted: { label: 'Waiting list', tone: 'info' },
  };

/**
 * A registration in the office (docs/design/39, part 4): status and the steps of its process with each
 * level's decision, what this user may decide now, the slot and admit card, the offer, the corrections
 * asked, the documents, the answers and the history.
 */
export default async function RegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const r = await apiFetch<Detail>(`/admissions/registrations/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const st = REG_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
  const fields = r.def.fields
    .filter((f) => !LAYOUT_TYPES.includes(f.type) && f.type !== 'age')
    .map((f) => ({ key: f.key, label: f.label }));
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const can = (p: string) => me.permissions.includes(p);
  // Admit: the class's sections in the session's year; cancel: what would be refunded
  const sections =
    r.status === 'fee_paid'
      ? await apiFetch<{
          sections: Array<{ id: string; name: string; capacity: number | null; enrolled: number }>;
        }>(`/admissions/cycles/${r.session.id}/admit/${r.class.id}`)
          .then((x) => x.sections)
          .catch(() => [])
      : [];
  const refund = ['fee_paid', 'admitted'].includes(r.status)
    ? await apiFetch<{
        refund: { paid: number; pct: number; deduction: number; amount: number } | null;
      }>(`/admissions/registrations/${r.id}/cancel`)
        .then((x) => x.refund)
        .catch(() => null)
    : null;
  // the family's questions about this registration (docs/design/43, part 4); the helpdesk decides who sees them
  const queries = await apiFetch<{ data: Ticket[] }>(
    `/helpdesk/tickets?desk=candidate&applicationId=${r.id}&size=25`,
  )
    .then((x) => x.data)
    .catch(() => [] as Ticket[]);
  return (
    <>
      <PageHeader
        kicker={`${r.session.name} · ${r.class.name}`}
        title={r.candidate ?? `Registration ${r.id}`}
        description={
          r.number
            ? `Registration no. ${r.number}${r.admissionNo ? ` · Admission no. ${r.admissionNo}` : ''}`
            : 'Not registered yet: the registration fee is due.'
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/registrations">
              Registrations
            </a>
            {r.enteredByOffice || r.feeDue > 0 ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/admissions/desk/${r.id}`}>
                Desk
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-rp">
        <Card elevated title="Process">
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {r.category ? <span className="ep-kicker"> · {r.category}</span> : null}
            {r.merit !== null ? <span className="ep-kicker"> · merit {r.merit}</span> : null}
            {r.waitRank ? (
              <span className="ep-kicker"> · waiting list no. {r.waitRank}</span>
            ) : null}
          </p>
          {!r.process.hasProcess && r.number ? (
            <p className="ep-field__help">
              No approval process is set for {r.class.name}. Give the class a process in{' '}
              <a href="/admissions/setup">Admission set-up</a>.
            </p>
          ) : null}
          {r.process.steps.length ? (
            <ol className="ep-rs" aria-label="Steps">
              {r.process.steps.map((s, i) => (
                <li key={s.stageId} className="ep-rs__step" data-state={s.state}>
                  <span className="ep-rs__dot" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <span className="ep-rs__name">{s.name}</span>{' '}
                    <span className="ep-sr-only">
                      (
                      {s.state === 'done'
                        ? 'done'
                        : s.state === 'current'
                          ? 'waiting here'
                          : s.state === 'rejected'
                            ? 'not selected'
                            : 'later'}
                      )
                    </span>
                  </span>
                  <ul className="ep-rs__levels">
                    {s.levels.map((l) => (
                      <li key={l.no}>
                        {s.levels.length > 1
                          ? l.name === `Level ${String(l.no)}`
                            ? `${l.name}: `
                            : `Level ${String(l.no)} · ${l.name}: `
                          : ''}
                        {l.result ? (
                          <>
                            <Badge tone={DECISION[l.result.decision]?.tone ?? 'info'}>
                              {DECISION[l.result.decision]?.label ?? l.result.decision}
                            </Badge>{' '}
                            {l.result.attendance === 'absent' ? 'absent · ' : ''}
                            {l.result.marks !== null
                              ? `${String(l.result.marks)}${l.result.maxMarks ? `/${String(l.result.maxMarks)}` : ''} · `
                              : ''}
                            {l.result.by ?? ''} · {dmy(l.result.at)}
                            {l.result.remarks ? (
                              <div className="ep-field__help" style={{ margin: 0 }}>
                                Remark: {l.result.remarks}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="ep-kicker">
                            {s.state === 'current' && l.no === r.process.levelNo ? 'waiting' : '-'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
        <Card elevated title="Decision">
          {r.status === 'sent_back' ? (
            <p style={{ marginTop: 0 }}>
              Sent to the family for correction; it comes back here when they submit again.
            </p>
          ) : null}
          {r.offer && r.status === 'offered' ? (
            <p style={{ marginTop: 0 }}>
              Offered on {dmy(r.offer.offeredAt)}: admission fee {rupees(r.offer.admissionFee)}, to
              be paid by {dmy(r.offer.expiresAt)}.
            </p>
          ) : null}
          {r.slot ? (
            <p style={{ marginTop: 0 }}>
              {r.slot.stage}: {whenIst(r.slot.startsAt)} at {r.slot.venue}, roll no. {r.slot.rollNo}{' '}
              <a href={`/admissions/schedule/${r.slot.slotId}`}>Slot</a>{' '}
              <ViewDownload href={`/api/admission-desk/admit/${r.id}`} what="the admit card" />
            </p>
          ) : null}
          <RegistrationActions
            id={r.id}
            current={r.process.current}
            canAct={r.process.canAct}
            categories={r.categories}
            categoryId={r.categoryId}
            fields={fields}
            undoable={r.process.undoable}
            steps={r.process.steps.map((s) => ({ name: s.name, state: s.state }))}
            isAdmin={me.permissions.includes('admissions.setup.manage')}
          />
          {r.status === 'cancelled' && r.cancelReason ? (
            <p style={{ margin: 0 }}>
              Cancelled on {dmy(r.cancelledAt)}: {r.cancelReason}
            </p>
          ) : null}
          <RegistrationOffice
            id={r.id}
            status={r.status}
            admissionFee={r.offer?.admissionFee ?? 0}
            sections={sections}
            refund={refund}
            canCollect={can('admissions.fee.collect')}
            canAdmit={can('admissions.application.admit')}
            canCancel={can('admissions.application.cancel')}
            studentId={r.studentId}
          />
        </Card>
      </div>
      {r.points ? (
        <Card elevated title="Merit points" style={{ marginBottom: 'var(--sp-4)' }}>
          <RegistrationPointsCheck
            key={`${r.points.total}-${r.points.confirmedAt ?? ''}`}
            id={r.id}
            initial={r.points}
            merit={r.merit}
            canEdit={
              can('admissions.application.review') &&
              !['draft', 'admitted', 'cancelled', 'withdrawn'].includes(r.status)
            }
          />
        </Card>
      ) : null}
      <div className="ep-rp">
        <Card elevated title="Documents">
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Documents</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Date</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.hasPdf ? (
                  <tr>
                    <td>Registration form</td>
                    <td>{dmy(r.submittedAt)}</td>
                    <td>
                      <ViewDownload
                        href={`/api/admission-desk/form/${r.id}`}
                        what="the registration form"
                      />
                    </td>
                  </tr>
                ) : null}
                {r.hasAdmissionForm ? (
                  <tr>
                    <td>Admission form ({r.admissionNo})</td>
                    <td>-</td>
                    <td>
                      <ViewDownload
                        href={`/api/admission-desk/admission/${r.id}`}
                        what="the admission form"
                      />
                    </td>
                  </tr>
                ) : null}
                {r.receipts.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.head} {x.receiptNo} · {rupees(x.amount)}
                    </td>
                    <td>{dmy(x.date)}</td>
                    <td>
                      <ViewDownload
                        href={`/api/admission-desk/receipt/${x.id}`}
                        what={`receipt ${x.receiptNo}`}
                      />
                    </td>
                  </tr>
                ))}
                {r.def.fields
                  .filter((f) => f.type === 'file' || f.type === 'photo')
                  .flatMap((f) =>
                    (Array.isArray(r.answers[f.key]) ? (r.answers[f.key] as string[]) : []).map(
                      (fid, i) => (
                        <tr key={`${f.key}-${fid}`}>
                          <td>
                            {f.label}
                            {i ? ` (${String(i + 1)})` : ''}
                          </td>
                          <td>-</td>
                          <td>
                            <ViewDownload
                              href={`/api/admission-desk/file/${r.id}:${fid}`}
                              what={f.label}
                            />
                          </td>
                        </tr>
                      ),
                    ),
                  )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card elevated title="Corrections and history">
          {r.corrections.length ? (
            <ul className="ep-rp__events" style={{ marginBottom: 'var(--sp-3)' }}>
              {r.corrections.map((x) => (
                <li key={x.id}>
                  <Badge
                    tone={
                      x.status === 'open'
                        ? 'warning'
                        : x.status === 'resubmitted'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {x.status === 'open'
                      ? 'Correction asked'
                      : x.status === 'resubmitted'
                        ? 'Corrected'
                        : 'Withdrawn'}
                  </Badge>{' '}
                  {x.fields.map(label).join(', ')}: {x.remark}
                  <div className="ep-kicker">
                    {x.by ?? ''} · {dmy(x.at)}
                    {x.dueOn ? ` · by ${dmy(x.dueOn)}` : ''}
                    {x.resubmittedAt ? ` · corrected ${dmy(x.resubmittedAt)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="ep-rp__events">
            {r.events.map((e) => (
              <li key={e.id}>
                {e.note ?? REG_STATUS[e.status]?.label ?? e.status}
                <div className="ep-kicker">
                  {e.actor ?? 'System'} · {whenIst(e.at)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {queries.length ? (
        <Card elevated title="Questions from the family" style={{ marginBottom: 'var(--sp-4)' }}>
          <ul className="ep-rp__events">
            {queries.map((q) => (
              <li key={q.id}>
                <a href={`/engagement/helpdesk/candidate/${q.id}`}>{q.number}</a> {q.subject}{' '}
                <Badge tone={STATUS_TONE[q.status]}>{STATUS_LABEL[q.status]}</Badge>
                <div className="ep-kicker">
                  {q.head} · {whenIst(q.openedAt)} · with{' '}
                  {q.assignedTo ?? q.assignedRoleName ?? q.assignedRole ?? '—'}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {r.canCorrect || r.answerChanges.length ? (
        <Card elevated title="Corrections by the office" style={{ marginBottom: 'var(--sp-4)' }}>
          <ApplicationCorrect
            id={r.id}
            fields={r.def.fields
              .filter((f) => !LAYOUT_TYPES.includes(f.type))
              .map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                options:
                  f.options ??
                  (f.list ? r.options[f.list] : f.source ? r.options[`@${f.source}`] : undefined),
              }))}
            answers={r.answers}
            history={r.answerChanges}
            canCorrect={r.canCorrect}
          />
        </Card>
      ) : null}
      <Card elevated title="Answers">
        <DeskForm
          id={r.id}
          def={r.def}
          options={r.options}
          answers={r.answers}
          files={r.files}
          readOnly
        />
      </Card>
    </>
  );
}
