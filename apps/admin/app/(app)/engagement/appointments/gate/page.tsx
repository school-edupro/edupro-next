import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { checkInAppointment, checkOutAppointment, findAtGate } from '@/lib/appointment-actions';
import {
  STATE_LABEL,
  STATE_TONE,
  timeOf,
  when,
  whoOf,
  type Appointment,
  dayOf,
  today,
} from '@/lib/appointments';

interface Board {
  found: Appointment[];
  inside: Appointment[];
  expected: Appointment[];
}

/**
 * The gate: scan the visitor's pass (a scanner types the link) or type the pass code, the appointment
 * number or the mobile, then check in. Below: who is inside now and who is still expected today. The
 * search is posted, so a pass code or a mobile never sits in the address bar.
 */
export default async function AppointmentGatePage({
  searchParams,
}: {
  searchParams: Promise<{ found?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const ids = (sp.found ?? '').split(',').filter((x) => /^\d{1,18}$/.test(x));
  const [me, board] = await Promise.all([
    getMe(),
    apiFetch<Board>(`/appointments/gate/board${ids.length ? `?found=${ids.join(',')}` : ''}`),
  ]);
  const canOpen = me.permissions.includes('engagement.appointment.view');
  const here = '/engagement/appointments/gate';
  const row = (a: Appointment, back: string) => (
    <tr key={a.id}>
      <td>{canOpen ? <a href={`/engagement/appointments/${a.id}`}>{a.number}</a> : a.number}</td>
      <td>
        {a.hasPhoto ? (
          <img
            className="ep-appt__thumb"
            src={`/api/appointments/${a.id}/photo?gate=1`}
            alt={`Photo of ${a.visitorName ?? 'the visitor'}`}
          />
        ) : null}
        {whoOf(a)}
        <div className="ep-field__help">
          {[
            a.visitorMobile,
            a.visitorOrg,
            a.partySize > 1 ? `${String(a.partySize)} people` : null,
            a.idProofKind ? `${a.idProofKind}${a.idProofLast4 ? ` …${a.idProofLast4}` : ''}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </td>
      <td>
        {a.hostName}
        {a.withName ? <div className="ep-field__help">{a.withName}</div> : null}
      </td>
      <td>
        {a.startsAt && dayOf(a.startsAt) !== today() ? when(a.startsAt) : timeOf(a.startsAt)}
        {a.place ? <div className="ep-field__help">{a.place}</div> : null}
      </td>
      <td>
        <Badge tone={STATE_TONE[a.state]}>{STATE_LABEL[a.state]}</Badge>
      </td>
      <td>
        {a.state === 'approved' ? (
          <form action={checkInAppointment} className="ep-gate__act">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="returnTo" value={back} />
            <input
              name="badgeNo"
              className="ep-input"
              maxLength={20}
              placeholder="Badge no."
              aria-label={`Badge number for ${a.number}`}
            />
            <Button type="submit" size="sm" aria-label={`Check in ${a.number}`}>
              Check in
            </Button>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/engagement/appointments/${a.id}/card`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Visitor card of ${a.number}`}
            >
              Card
            </a>
          </form>
        ) : a.state === 'checked_in' ? (
          <form action={checkOutAppointment} className="ep-gate__act">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="returnTo" value={back} />
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/engagement/appointments/${a.id}/card`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Visitor card of ${a.number}`}
            >
              Card
            </a>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              aria-label={`Check out ${a.number}`}
            >
              Check out
            </Button>
          </form>
        ) : a.state === 'requested' ? (
          <span className="ep-field__help">Not confirmed yet</span>
        ) : null}
        {a.state === 'approved' && a.startsAt && dayOf(a.startsAt) !== today() ? (
          <div className="ep-field__help">Not today: check-in opens on the day of the visit.</div>
        ) : null}
      </td>
    </tr>
  );
  const table = (label: string, rows: Appointment[], back: string) => (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Visitor</th>
            <th scope="col">To meet</th>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="ep-sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>{rows.map((a) => row(a, back))}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="Gate"
        description="Scan the visitor’s pass or type its code. Checking in writes the visitor log."
      />
      <AppointmentNav
        current="/engagement/appointments/gate"
        permissions={me.permissions}
        ok={sp.ok}
      />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card title="Find the visitor">
        <form action={findAtGate} className="ep-hd__row">
          <label className="ep-field" htmlFor="gate-code">
            <span className="ep-field__label">
              Pass (scan), pass code, appointment number, or the mobile of a visit today
            </span>
            <input
              id="gate-code"
              name="code"
              className="ep-input"
              required
              minLength={2}
              maxLength={300}
              autoComplete="off"
              // the gate keeper scans straight into this box
              autoFocus
            />
          </label>
          <div>
            <Button type="submit">Find</Button>
          </div>
        </form>
        {board.found.some((a) => a.state !== 'checked_in') ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            {table(
              'Found',
              board.found.filter((a) => a.state !== 'checked_in'),
              here,
            )}
            <p className="ep-field__help">
              Visit time:{' '}
              {board.found
                .filter((a) => a.state !== 'checked_in')
                .map((a) => when(a.startsAt) || 'no slot yet')
                .join(' · ')}
            </p>
          </div>
        ) : board.found.length ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Alert tone="info">
              {board.found.map((a) => a.number).join(', ')}: already inside. Check out under Inside
              now.
            </Alert>
          </div>
        ) : sp.found === 'none' ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Alert tone="warning">
              Nothing matches. A walk-in without an appointment goes to the front desk or the
              visitor log.
            </Alert>
          </div>
        ) : null}
      </Card>
      <Card
        title={`Inside now · ${String(board.inside.length)}`}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        {board.inside.length ? (
          table('Inside now', board.inside, here)
        ) : (
          <p className="ep-field__help">No appointment visitor is inside.</p>
        )}
      </Card>
      <Card
        title={`Expected today · ${String(board.expected.length)}`}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        {board.expected.length ? (
          table('Expected today', board.expected, here)
        ) : (
          <p className="ep-field__help">Nobody else is expected today.</p>
        )}
      </Card>
    </>
  );
}
