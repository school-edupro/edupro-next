import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelAppointment } from '../actions';
import { studentLabel } from '../shared';

type State =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
interface Detail {
  id: string;
  number: string;
  state: State;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
  hostName: string | null;
  withName: string | null;
  purpose: string;
  startsAt: string | null;
  previousStartsAt: string | null;
  place: string | null;
  visitorName: string | null;
  visitorMobile: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  createdAt: string;
  passLink: string | null;
  passQr: string | null;
  passBarcode: string | null;
  events: Array<{ kind: string; at: string; startsAt: string | null; reason: string | null }>;
}
const STATE: Record<State, [string, 'warning' | 'success' | 'danger' | 'info' | 'neutral']> = {
  requested: ['Waiting for the school', 'warning'],
  approved: ['Confirmed', 'success'],
  rejected: ['Not confirmed', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
  checked_in: ['Arrived', 'info'],
  completed: ['Completed', 'neutral'],
  no_show: ['Did not come', 'danger'],
};
const EVENT: Record<string, string> = {
  requested: 'Requested',
  approved: 'Confirmed',
  rejected: 'Declined',
  rescheduled: 'Moved to a new time',
  cancelled: 'Cancelled',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  no_show: 'Did not come',
  reminded: 'Reminder sent',
};
const svg = (v: string) => `data:image/svg+xml;utf8,${encodeURIComponent(v)}`;
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One appointment of the family: everything that was asked, what the school decided, and the pass. */
export default async function AppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sent = (await searchParams).ok === '1';
  const lang = await currentLang();
  let a: Detail;
  try {
    a = await bff.api.fetch<Detail>(`/appointments/mine/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const facts: Array<[string, string | null]> = [
    [t(lang, 'Child'), studentLabel(a, t(lang, 'Adm. no.'))],
    [t(lang, 'To meet'), [a.hostName, a.withName].filter(Boolean).join(' · ') || null],
    [t(lang, 'When'), a.startsAt ? when(a.startsAt) : t(lang, 'Not decided yet')],
    [t(lang, 'Moved from'), a.previousStartsAt ? when(a.previousStartsAt) : null],
    [t(lang, 'Where'), a.place],
    [t(lang, 'Purpose'), a.purpose],
    [t(lang, 'Requested by'), a.visitorName],
    [t(lang, 'Mobile'), a.visitorMobile],
    [t(lang, 'Requested on'), when(a.createdAt)],
    [t(lang, 'Note from the school'), a.decisionNote ?? a.cancelReason],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={`${t(lang, 'Appointment')} ${a.number}`}
        title={[a.student, a.withName ?? a.hostName].filter(Boolean).join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={STATE[a.state][1]}>{t(lang, STATE[a.state][0])}</Badge>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/appointments">
              {t(lang, 'Back to appointments')}
            </a>
          </span>
        }
      />
      {sent ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Appointment requested. The school will confirm it and send you the pass.')}
        </div>
      ) : null}
      {a.passQr ? (
        <Card title={t(lang, 'Gate pass')} style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="ep-appt__poster">
            <p className="ep-pass__name">{a.visitorName ?? a.student}</p>
            {a.student ? <p style={{ margin: 0 }}>{studentLabel(a, t(lang, 'Adm. no.'))}</p> : null}
            <p style={{ margin: 0 }}>
              {[a.number, a.withName ?? a.hostName, a.startsAt ? when(a.startsAt) : null, a.place]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <img src={svg(a.passQr)} alt={t(lang, 'QR code of the gate pass')} />
            {a.passBarcode ? (
              <img
                className="ep-appt__barcode"
                src={svg(a.passBarcode)}
                alt={t(lang, 'Barcode of the gate pass')}
              />
            ) : null}
            <p className="ep-field__help">
              {t(lang, 'Show this at the school gate on the day of the appointment.')}
            </p>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/appointment-card/${a.id}`}
            >
              {t(lang, 'Download the card (PDF)')}
            </a>
          </div>
        </Card>
      ) : null}
      <Card title={t(lang, 'Details')} style={{ marginBottom: 'var(--sp-3)' }}>
        <dl className="ep-hd__facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          {['requested', 'approved'].includes(a.state) ? (
            <form action={cancelAppointment}>
              <input type="hidden" name="id" value={a.id} />
              <Button type="submit" variant="ghost" size="sm">
                {t(lang, 'Cancel')}
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
      <Card title={t(lang, 'History')}>
        <ul className="ep-hd__timeline">
          {a.events.map((e, i) => (
            <li key={i}>
              <span>
                {t(lang, EVENT[e.kind] ?? e.kind)}
                {e.startsAt ? ` · ${e.startsAt.replace('T', ' ')}` : ''}
                {e.reason ? ` · ${e.reason}` : ''}
              </span>
              <span className="ep-field__help">{when(e.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
