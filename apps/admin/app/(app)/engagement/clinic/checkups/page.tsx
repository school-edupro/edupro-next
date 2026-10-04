import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { today } from '@/lib/appointments';
import { saveHealthCamp } from '@/lib/clinic-actions';
import type { Camp, ClinicOptions } from '@/lib/clinic';

/**
 * Health check-ups: the school examines every pupil once or twice a year. Each check-up ("Annual check-up,
 * first term") is opened here, filled class by class, and published to the parents class by class.
 */
export default async function HealthCheckupsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, camps, options] = await Promise.all([
    getMe(),
    apiFetch<{ data: Camp[] }>('/clinic/camps'),
    apiFetch<ClinicOptions>('/clinic/options'),
  ]);
  const manage = me.permissions.includes('engagement.clinic.manage');
  const doctors = options.masters.filter((m) => m.kind === 'doctor');
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Health check-ups"
        description="The yearly or half-yearly medical check of every pupil, and the health card the parents get."
      />
      <ClinicNav current="/engagement/clinic/checkups" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {manage ? (
        <Card title="Start a check-up" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={saveHealthCamp} className="ep-hd__row">
            <label className="ep-field" htmlFor="hc-name">
              <span className="ep-field__label">Name</span>
              <input
                id="hc-name"
                name="name"
                className="ep-input"
                required
                minLength={3}
                maxLength={120}
                placeholder="Annual check-up 2026-27, first term"
              />
            </label>
            <label className="ep-field" htmlFor="hc-from">
              <span className="ep-field__label">Starts on</span>
              <input
                id="hc-from"
                name="startsOn"
                type="date"
                className="ep-input"
                required
                defaultValue={today()}
              />
            </label>
            <label className="ep-field" htmlFor="hc-to">
              <span className="ep-field__label">Ends on (optional)</span>
              <input id="hc-to" name="endsOn" type="date" className="ep-input" />
            </label>
            <label className="ep-field" htmlFor="hc-doc">
              <span className="ep-field__label">Doctor</span>
              <select id="hc-doc" name="doctorId" className="ep-select" defaultValue="">
                <option value="">Choose</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="hc-place">
              <span className="ep-field__label">Place</span>
              <input
                id="hc-place"
                name="place"
                className="ep-input"
                maxLength={120}
                placeholder="School clinic"
              />
            </label>
            <div>
              <Button type="submit">Start</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {camps.data.length === 0 ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            No health check-up has been started yet.
          </p>
        </Card>
      ) : null}
      {camps.data.map((c) => (
        <Card
          key={c.id}
          title={c.name}
          actions={
            <Badge tone={c.status === 'open' ? 'success' : 'neutral'}>
              {c.status === 'open' ? 'Open' : 'Closed'}
            </Badge>
          }
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {c.startsOn}
            {c.endsOn ? ` to ${c.endsOn}` : ''}
            {c.doctor ? ` · ${c.doctor}` : ''}
            {c.place ? ` · ${c.place}` : ''}
          </p>
          <p className="ep-field__help">
            {c.examined} of {c.pupils} pupils examined (
            {c.pupils ? Math.round((100 * c.examined) / c.pupils) : 0}%) · {c.published} published
            to parents · {c.attention} need attention
          </p>
          <div className="ep-gate__act">
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href={`/engagement/clinic/checkups/${c.id}`}
            >
              Open class by class
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/clinic/camps/${c.id}/report`}
              aria-label={`Excel of ${c.name}`}
            >
              Excel
            </a>
          </div>
        </Card>
      ))}
    </>
  );
}
