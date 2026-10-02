import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { acceptSchoolTransfer, closeSchoolTransfer } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { SchoolTransfer } from '@/lib/types';

const TONE: Record<SchoolTransfer['status'], 'warning' | 'success' | 'danger' | 'neutral'> = {
  requested: 'warning',
  accepted: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** An incoming transfer waiting here: what comes with it, the accept form and the reject form. */
function Incoming({
  t,
  sections,
  suggested,
  open,
}: {
  t: SchoolTransfer;
  sections: Array<{ value: string; label: string }>;
  suggested: string;
  open: boolean;
}) {
  const d = t.details;
  return (
    <details className="ep-wd__act" open={open}>
      <summary>Accept or reject</summary>
      {d ? (
        <dl className="ep-transfer__facts">
          {(
            [
              ['Date of birth', d.dob],
              ['Gender', d.gender],
              ['Father', d.fatherName],
              ['Mother', d.motherName],
              ['Mobile', d.mobile],
              ['Address', d.address],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      ) : null}
      <p className="ep-field__help">
        Comes with: profile
        {t.carries.photos.length ? `, ${String(t.carries.photos.length)} photo(s)` : ''}
        {t.carries.documents ? `, ${String(t.carries.documents)} document(s)` : ''}
        {t.carries.parentLogins ? ', the parents’ login' : ''}
        {t.carries.studentLogin ? ', the student’s login' : ''}. Fees start fresh from this school’s
        fee structure.
      </p>
      <form action={acceptSchoolTransfer} className="ep-wd__form">
        <input type="hidden" name="id" value={t.id} />
        <label className="ep-field" htmlFor={`ac-sec-${t.id}`}>
          <span className="ep-field__label">Class and section *</span>
          <select id={`ac-sec-${t.id}`} name="classSectionId" className="ep-select" required>
            <option value="">Choose…</option>
            {sections.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={`ac-no-${t.id}`}>
          <span className="ep-field__label">New admission number *</span>
          <input
            id={`ac-no-${t.id}`}
            name="admissionNo"
            className="ep-input"
            required
            maxLength={40}
            pattern="[A-Za-z0-9/\-]+"
            defaultValue={suggested}
          />
        </label>
        <label className="ep-field" htmlFor={`ac-roll-${t.id}`}>
          <span className="ep-field__label">Roll number</span>
          <input
            id={`ac-roll-${t.id}`}
            name="rollNo"
            type="number"
            min={1}
            max={999}
            className="ep-input"
            placeholder="next free"
          />
        </label>
        <Button type="submit" size="sm">
          Accept and admit
        </Button>
      </form>
      <form action={closeSchoolTransfer} className="ep-wd__form">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="how" value="reject" />
        <label className="ep-field ep-wd__wide" htmlFor={`rj-${t.id}`}>
          <span className="ep-field__label">Reason to reject</span>
          <input
            id={`rj-${t.id}`}
            name="reason"
            className="ep-input"
            required
            maxLength={300}
            placeholder="e.g. no seat in the class"
          />
        </label>
        <Button type="submit" size="sm" variant="ghost">
          Reject
        </Button>
      </form>
    </details>
  );
}

/**
 * Transfers between schools of the group: students other schools are sending here (accept them into
 * a section with this school's admission number) and the students this school has sent.
 */
export default async function SchoolTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; open?: string }>;
}) {
  const sp = await searchParams;
  const [list, sections, next] = await Promise.all([
    apiFetch<{ data: SchoolTransfer[] }>('/people/school-transfers?box=all'),
    sectionOptions(),
    apiFetch<{ admissionNo: string | null }>('/people/profile/next-numbers').catch(() => ({
      admissionNo: null,
    })),
  ]);
  const incoming = list.data.filter((t) => t.direction === 'incoming');
  const outgoing = list.data.filter((t) => t.direction === 'outgoing');
  const waiting = incoming.filter((t) => t.status === 'requested');
  const row = (t: SchoolTransfer) => (
    <li key={t.id} className="ep-transfer">
      <div className="ep-transfer__head">
        <strong>{t.student.name}</strong>
        <span className="ep-field__help">
          {t.student.admissionNo}
          {t.student.classSection ? ` · ${t.student.classSection}` : ''} ·{' '}
          {t.direction === 'incoming' ? `from ${t.fromSchool}` : `to ${t.toSchool}`} · sent{' '}
          {when(t.requestedAt)}
          {t.requestedBy ? ` by ${t.requestedBy}` : ''}
        </span>
        <Badge tone={TONE[t.status]}>{t.status}</Badge>
      </div>
      {t.note ? <p className="ep-transfer__note">{t.note}</p> : null}
      {t.decidedAt ? (
        <div className="ep-field__help">
          {t.status === 'accepted'
            ? 'Accepted'
            : t.status === 'rejected'
              ? 'Rejected'
              : 'Withdrawn'}
          {t.decidedBy ? ` by ${t.decidedBy}` : ''} on {when(t.decidedAt)}
          {t.decisionNote ? `: ${t.decisionNote}` : ''}
          {t.status === 'accepted' && t.direction === 'incoming' && t.toStudentId ? (
            <>
              {' · '}
              <a href={`/people/students/${t.toStudentId}`}>Open the student</a>
            </>
          ) : null}
        </div>
      ) : null}
      {t.direction === 'outgoing' && t.withdrawalId ? (
        <div className="ep-field__help">
          <a href={`/people/withdrawals/${t.withdrawalId}`}>Withdrawal</a>
        </div>
      ) : null}
      {t.direction === 'incoming' && t.status === 'requested' ? (
        <Incoming
          t={t}
          sections={sections}
          suggested={next.admissionNo ?? ''}
          open={sp.open === t.id || waiting.length === 1}
        />
      ) : null}
    </li>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'People', href: '/people/students' }, { label: 'School transfers' }]}
      />
      <PageHeader
        kicker="People"
        title="Transfers between schools"
        description="A school of the group sends a student once the withdrawal has cleared; the receiving school admits them with its own admission number."
      />
      <Notice params={sp} />
      <Card
        title={`Coming to this school${waiting.length ? ` · ${String(waiting.length)} waiting` : ''}`}
      >
        {incoming.length ? (
          <ul className="ep-transfer__list">{incoming.map(row)}</ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No student has been sent here.
          </p>
        )}
      </Card>
      <div style={{ height: 'var(--sp-4)' }} />
      <Card title="Sent to other schools">
        {outgoing.length ? (
          <ul className="ep-transfer__list">{outgoing.map(row)}</ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Send a student from their withdrawal page once every department has cleared.
          </p>
        )}
      </Card>
    </>
  );
}
