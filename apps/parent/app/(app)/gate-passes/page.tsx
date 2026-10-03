import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { requestGatePass } from '../appointments/actions';

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

/** Gate passes for a child (Sprint 19): ask for an early leave or a late arrival, and see the passes. */
export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let passes: GatePass[];
  let viewer: Viewer;
  try {
    [passes, viewer] = await Promise.all([
      bff.api.fetch<{ data: GatePass[] }>('/engagement/mine/gate-passes').then((r) => r.data),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Gate passes')} />
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
        title={t(lang, 'Gate passes')}
        description={t(lang, 'Ask for an early leave or a late arrival for your child.')}
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Gate pass requested. The school will confirm on WhatsApp.')}
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
