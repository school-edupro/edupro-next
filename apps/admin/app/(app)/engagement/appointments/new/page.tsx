import { Alert, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { AutoSubmit } from '@/components/appointments/AutoSubmit';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { bookAppointment } from '@/lib/appointment-actions';
import { hoursLine, today, type BookableHost, type SlotList } from '@/lib/appointments';

interface StudentHit {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  guardian: string | null;
  relation: string | null;
  mobileEnd: string | null;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The front desk books for a walk-in, a caller or a parent: pick whom to meet and the day, then a free
 * slot and the visitor's details. A booking about a pupil starts with a search by name or admission
 * number; the desk checks the class and the guardian and selects the pupil before any slot shows. It is
 * confirmed at once unless left as a request.
 */
export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    host?: string;
    date?: string;
    sq?: string;
    student?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [me, setup] = await Promise.all([
    getMe(),
    apiFetch<{
      data: BookableHost[];
      purposes: string[];
      idProofKinds: string[];
      maxParty: number;
    }>('/appointments/hosts'),
  ]);
  const host = setup.data.find((h) => h.id === sp.host) ?? null;
  const date = DATE.test(sp.date ?? '') ? sp.date! : today();
  const sq = sp.sq?.trim().slice(0, 80) ?? '';
  // about a pupil: search, check who it is, select; the guardian on record is then the one told
  const hits =
    sq.length >= 2
      ? await apiFetch<{ data: StudentHit[] }>(`/appointments/students?q=${encodeURIComponent(sq)}`)
          .then((r) => r.data)
          .catch(() => [])
      : [];
  const student = hits.find((x) => x.id === sp.student) ?? null;
  // a pupil's guardian on record is the visitor: nothing more to ask (an outside visitor fills the form)
  const forGuardian = Boolean(student?.guardian);
  // a search that is not yet settled on one pupil holds the slots back
  const choosing = sq.length >= 2 && !student;
  const slots =
    host && !choosing
      ? await apiFetch<SlotList>(
          `/appointments/slots?${new URLSearchParams({
            hostId: host.id,
            date,
            ...(student ? { studentId: student.id } : {}),
          }).toString()}`,
        )
      : null;
  const here = `/engagement/appointments/new?${new URLSearchParams({
    ...(host ? { host: host.id } : {}),
    date,
    ...(sq ? { sq } : {}),
    ...(student ? { student: student.id } : {}),
  }).toString()}`;
  /** This page with the search kept and one pupil selected (or the selection dropped). */
  const pick = (id: string | null) =>
    `/engagement/appointments/new?${new URLSearchParams({
      ...(host ? { host: host.id } : {}),
      date,
      ...(id ? { sq, student: id } : {}),
    }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Appointments', href: '/engagement/appointments' }, { label: 'Book' }]}
      />
      <PageHeader
        kicker="Appointments"
        title="Book an appointment"
        description="For a walk-in, a caller or a parent at the desk. Pick whom to meet and the day, then a free slot."
      />
      <AppointmentNav current="" permissions={me.permissions} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card title="1. Whom to meet and when">
        <form id="nb-form" method="get" className="ep-hd__row">
          <AutoSubmit />
          <SelectField
            id="nb-host"
            name="host"
            label="To meet"
            defaultValue={host?.id ?? ''}
            options={[
              { value: '', label: 'Choose' },
              ...setup.data.map((h) => ({
                value: h.id,
                label: `${h.name}${h.person ? ` · ${h.person}` : ''}`,
              })),
            ]}
          />
          <label className="ep-field" htmlFor="nb-date">
            <span className="ep-field__label">Day</span>
            <input
              id="nb-date"
              name="date"
              type="date"
              className="ep-input"
              required
              min={today()}
              defaultValue={date}
            />
          </label>
          <label className="ep-field" htmlFor="nb-sq">
            <span className="ep-field__label">
              Student name or admission no. (if about a pupil)
            </span>
            <input
              id="nb-sq"
              name="sq"
              type="search"
              className="ep-input"
              maxLength={80}
              defaultValue={sq}
            />
          </label>
          {student ? <input type="hidden" name="student" value={student.id} /> : null}
          <div>
            <Button type="submit" variant="secondary">
              Show slots
            </Button>
          </div>
        </form>
        {host ? <p className="ep-field__help">Visiting hours: {hoursLine(host.hours)}</p> : null}
        {sq.length === 1 ? (
          <Alert tone="warning">Type at least two letters of the name or admission number.</Alert>
        ) : null}
        {choosing && hits.length === 0 ? (
          <Alert tone="warning">No active student matches “{sq}”.</Alert>
        ) : null}
        {choosing && hits.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Matching students"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <table className="ep-table ep-table--dense">
              <caption>Check the class and the guardian, then select the student</caption>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Admission no.</th>
                  <th scope="col">Class</th>
                  <th scope="col">Guardian</th>
                  <th scope="col">
                    <span className="ep-sr-only">Select</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {hits.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{x.admissionNo}</td>
                    <td>{x.section ?? '—'}</td>
                    <td>
                      {x.guardian ?? '—'}
                      {x.relation || x.mobileEnd ? (
                        <div className="ep-field__help">
                          {[x.relation, x.mobileEnd ? `mobile ending ${x.mobileEnd}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="submit"
                        form="nb-form"
                        name="student"
                        value={x.id}
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        aria-label={`Select ${x.name}, ${x.admissionNo}`}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {student ? (
          <Alert tone="success">
            About <strong>{student.name}</strong> · {student.section ?? 'no class'} ·{' '}
            {student.admissionNo}
            {student.guardian
              ? ` · ${student.guardian}${student.relation ? ` (${student.relation})` : ''}${student.mobileEnd ? `, mobile ending ${student.mobileEnd}` : ''}`
              : ''}
            .{' '}
            {student.guardian
              ? 'The guardian on record is the visitor and gets the confirmation.'
              : 'No guardian is on record: enter the visitor below.'}{' '}
            <a href={pick(null)}>Change</a>
          </Alert>
        ) : null}
        {!host && !choosing ? (
          <Alert tone="info">Choose whom to meet to see the free slots.</Alert>
        ) : null}
        {host?.kind === 'class_teacher' && !student ? (
          <Alert tone="warning">Search and select the student to find the class teacher.</Alert>
        ) : null}
      </Card>
      {slots?.closed ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Alert tone="warning">{slots.closed}</Alert>
        </div>
      ) : null}
      {host && slots && !slots.closed ? (
        <Card title="2. Slot and visitor" style={{ marginTop: 'var(--sp-4)' }}>
          {slots.slots.some((x) => x.available) ? (
            <form action={bookAppointment} className="ep-hd__form">
              <input type="hidden" name="hostId" value={host.id} />
              <input type="hidden" name="returnTo" value={here} />
              {student ? <input type="hidden" name="studentId" value={student.id} /> : null}
              <fieldset className="ep-slots">
                <legend className="ep-field__label">Free slots on {date}</legend>
                <div className="ep-slots__grid">
                  {slots.slots.map((x) => (
                    <label
                      key={x.time}
                      className="ep-slots__slot"
                      data-off={x.available ? undefined : ''}
                    >
                      <input
                        type="radio"
                        name="startsAt"
                        value={x.startsAt}
                        disabled={!x.available}
                        required
                      />
                      <span>{x.time}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {forGuardian ? null : (
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor="nb-name">
                    <span className="ep-field__label">Visitor name</span>
                    <input
                      id="nb-name"
                      name="visitorName"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label className="ep-field" htmlFor="nb-mobile">
                    <span className="ep-field__label">Mobile (for the confirmation)</span>
                    <input
                      id="nb-mobile"
                      name="visitorMobile"
                      className="ep-input"
                      inputMode="numeric"
                      pattern="[6-9][0-9]{9}"
                      title="A 10-digit mobile number"
                      maxLength={10}
                    />
                  </label>
                  <label className="ep-field" htmlFor="nb-email">
                    <span className="ep-field__label">Email (optional)</span>
                    <input
                      id="nb-email"
                      name="visitorEmail"
                      type="email"
                      className="ep-input"
                      maxLength={200}
                    />
                  </label>
                  <label className="ep-field" htmlFor="nb-org">
                    <span className="ep-field__label">Coming from (optional)</span>
                    <input id="nb-org" name="visitorOrg" className="ep-input" maxLength={120} />
                  </label>
                </div>
              )}
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="nb-purpose">
                  <span className="ep-field__label">Purpose</span>
                  <input
                    id="nb-purpose"
                    name="purpose"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={500}
                    list="nb-purposes"
                  />
                  <datalist id="nb-purposes">
                    {setup.purposes.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                {forGuardian ? null : (
                  <>
                    <label className="ep-field" htmlFor="nb-party">
                      <span className="ep-field__label">People coming</span>
                      <input
                        id="nb-party"
                        name="partySize"
                        type="number"
                        className="ep-input"
                        min={1}
                        max={setup.maxParty}
                        defaultValue={1}
                      />
                    </label>
                    <SelectField
                      id="nb-idkind"
                      name="idProofKind"
                      label="ID proof (optional)"
                      defaultValue=""
                      options={[
                        { value: '', label: 'None' },
                        ...setup.idProofKinds.map((k) => ({ value: k, label: k })),
                      ]}
                    />
                    <label className="ep-field" htmlFor="nb-id4">
                      <span className="ep-field__label">Last 4 characters of the ID</span>
                      <input
                        id="nb-id4"
                        name="idProofLast4"
                        className="ep-input"
                        pattern="[A-Za-z0-9]{4}"
                        title="Only the last 4 characters; the full number is never kept"
                        maxLength={4}
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="ep-hd__row">
                <SelectField
                  id="nb-approve"
                  name="approve"
                  label="Confirm now?"
                  defaultValue="yes"
                  options={[
                    { value: 'yes', label: 'Yes, confirm and send the pass' },
                    { value: 'no', label: 'No, leave it as a request' },
                  ]}
                />
                <div>
                  <Button type="submit">Book</Button>
                </div>
              </div>
            </form>
          ) : (
            <Alert tone="warning">No free slot on this day; try another day or person.</Alert>
          )}
        </Card>
      ) : null}
    </>
  );
}
