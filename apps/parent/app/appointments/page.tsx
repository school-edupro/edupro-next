import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { requestAppointment, requestGatePass } from './actions';

interface Appointment {
  id: string;
  student: string;
  withKind: string;
  withName: string | null;
  purpose: string;
  preferredSlots: string[];
  confirmedAt: string | null;
  location: string | null;
  status: string;
  decisionNote: string | null;
  createdAt: string;
}
interface GatePass {
  id: string;
  student: string;
  kind: string;
  onDate: string;
  atTime: string | null;
  reason: string;
  passNo: string | null;
  status: string;
  escortName: string | null;
}
interface Viewer {
  students: Array<{ id: string; name: string }>;
}
const tone = (s: string) => (s === 'approved' ? 'success' : s === 'pending' ? 'warning' : 'danger');

/** Sprint 19: appointments with the school and gate passes, requested by the family. */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let appointments: Appointment[];
  let passes: GatePass[];
  let viewer: Viewer;
  try {
    [appointments, passes, viewer] = await Promise.all([
      bff.api.fetch<{ data: Appointment[] }>('/engagement/mine/appointments').then((r) => r.data),
      bff.api.fetch<{ data: GatePass[] }>('/engagement/mine/gate-passes').then((r) => r.data),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Appointments')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const students = viewer.students.map((s) => ({ value: s.id, label: s.name }));
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Appointments')}
        description={t(
          lang,
          'Ask to meet a teacher, the coordinator or the principal, or request a gate pass.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'pass'
            ? t(lang, 'Gate pass requested. The school will confirm on WhatsApp.')
            : t(lang, 'Appointment requested. The school will confirm a slot.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card title={t(lang, 'Request an appointment')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form action={requestAppointment}>
          <FormRow columns={2}>
            <SelectField
              id="studentId"
              name="studentId"
              label={t(lang, 'Child')}
              options={students}
            />
            <SelectField
              id="withKind"
              name="withKind"
              label={t(lang, 'To meet')}
              options={[
                { value: 'class_teacher', label: t(lang, 'Class teacher') },
                { value: 'coordinator', label: t(lang, 'Coordinator') },
                { value: 'principal', label: t(lang, 'Principal') },
              ]}
            />
            <InputField
              id="purpose"
              name="purpose"
              label={t(lang, 'Purpose')}
              required
              minLength={3}
              maxLength={500}
            />
            <InputField
              id="slot1"
              name="slot1"
              label={t(lang, 'Preferred slot')}
              type="datetime-local"
              required
            />
            <InputField
              id="slot2"
              name="slot2"
              label={`${t(lang, 'Alternative slot')} 1`}
              type="datetime-local"
            />
            <InputField
              id="slot3"
              name="slot3"
              label={`${t(lang, 'Alternative slot')} 2`}
              type="datetime-local"
            />
          </FormRow>
          <Button type="submit">{t(lang, 'Request')}</Button>
        </form>
      </Card>
      <Card title={t(lang, 'Your appointments')} style={{ marginBottom: 'var(--sp-3)' }}>
        {appointments.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No appointments yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {appointments.map((a) => (
              <li
                key={a.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {a.student} · {a.withName ?? a.withKind.replace('_', ' ')}
                  </strong>
                  <Badge tone={tone(a.status)}>{a.status}</Badge>
                </div>
                <div>{a.purpose}</div>
                <div className="ep-kicker">
                  {a.confirmedAt
                    ? `${t(lang, 'Confirmed')}: ${a.confirmedAt.slice(0, 16).replace('T', ' ')}${a.location ? ` · ${a.location}` : ''}`
                    : `${t(lang, 'Preferred')}: ${a.preferredSlots.map((s) => s.replace('T', ' ')).join(', ')}`}
                  {a.decisionNote ? ` · ${a.decisionNote}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t(lang, 'Request a gate pass')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form action={requestGatePass}>
          <FormRow columns={2}>
            <SelectField
              id="gp-studentId"
              name="studentId"
              label={t(lang, 'Child')}
              options={students}
            />
            <SelectField
              id="kind"
              name="kind"
              label={t(lang, 'Kind')}
              options={[
                { value: 'early_leave', label: t(lang, 'Early leave') },
                { value: 'late_arrival', label: t(lang, 'Late arrival') },
              ]}
            />
            <InputField id="onDate" name="onDate" label={t(lang, 'Date')} type="date" />
            <InputField id="atTime" name="atTime" label={t(lang, 'Time')} type="time" />
            <InputField
              id="reason"
              name="reason"
              label={t(lang, 'Reason')}
              required
              minLength={3}
              maxLength={300}
            />
            <InputField
              id="escortName"
              name="escortName"
              label={t(lang, 'Who will pick up')}
              maxLength={120}
            />
            <InputField
              id="escortRelation"
              name="escortRelation"
              label={t(lang, 'Relation')}
              maxLength={40}
            />
            <InputField
              id="escortMobile"
              name="escortMobile"
              label={t(lang, 'Mobile')}
              pattern="\\d{10}"
            />
          </FormRow>
          <Button type="submit" variant="secondary">
            {t(lang, 'Request gate pass')}
          </Button>
        </form>
      </Card>
      <Card title={t(lang, 'Your gate passes')}>
        {passes.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No gate passes yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {passes.map((p) => (
              <li
                key={p.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {p.passNo ? `${p.passNo} · ` : ''}
                    {p.student}
                  </strong>
                  <Badge tone={tone(p.status)}>{p.status}</Badge>
                </div>
                <div className="ep-kicker">
                  {p.kind === 'early_leave' ? t(lang, 'Early leave') : t(lang, 'Late arrival')} ·{' '}
                  {p.onDate}
                  {p.atTime ? ` ${p.atTime}` : ''} · {p.reason}
                  {p.escortName ? ` · ${p.escortName}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
