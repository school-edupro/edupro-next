import {
  Badge,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { updateAdmissionCycle } from '@/lib/actions';
import { createAdmissionSession } from '@/lib/admission-setup-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle, Year } from '@/lib/types';

/** Merit points a new session may award to applications (the scored application flow). */
const MERIT = [
  { code: 'sibling', name: 'Sibling studies here', points: 20, rule: 'sibling' },
  { code: 'staff_ward', name: 'Child of a staff member', points: 25, rule: 'staff_ward' },
  { code: 'alumni', name: 'Parent is an alumnus', points: 10, rule: 'alumni' },
  { code: 'single_girl', name: 'Single girl child', points: 10, rule: 'single_girl_child' },
  { code: 'distance', name: 'Lives within 5 km', points: 15, rule: 'distance_within:5' },
  { code: 'interview', name: 'Interaction (marked by staff)', points: 30, rule: '' },
] as const;

/**
 * Admission sessions: the list, and a short form for a new one. Classes, forms, seats and fees are set
 * on each session's own page.
 */
export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const [t, a, me] = await Promise.all([
    getTranslations('pages.admissions_cycles'),
    getTranslations('admissions'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('admissions.cycle.manage');
  const [cycles, years] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then((r) => r.data),
    apiFetch<{ data: Year[] }>('/platform/years')
      .then((r) => r.data.filter((y) => y.kind === 'academic' && y.status !== 'closed'))
      .catch(() => [] as Year[]),
  ]);
  const local = (iso: string) =>
    new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  // the year after the running one is the usual one to admit into
  const byStart = [...years].sort((x, y) => x.startDate.localeCompare(y.startDate));
  const active = byStart.find((y) => y.status === 'active');
  const nextYear =
    (active && byStart.find((y) => y.startDate > active.startDate)) ?? active ?? byStart[0];
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <a className="ep-btn ep-btn--primary ep-cy__new-btn" href="?new=1#new-session">
              New session
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />
      {cycles.length ? (
        <ul className="ep-cy__list" aria-label={t('title')}>
          {cycles.map((x) => (
            <li key={x.id} className="ep-card ep-cy__item">
              <div className="ep-cy__head">
                <a className="ep-cy__name" href={`/admissions/cycles/${x.id}`}>
                  {x.name}
                </a>
                <Badge
                  tone={
                    x.status === 'open' ? 'success' : x.status === 'closed' ? 'neutral' : 'warning'
                  }
                >
                  {x.status === 'open'
                    ? 'Taking registrations'
                    : x.status === 'closed'
                      ? 'Closed'
                      : 'Draft'}
                </Badge>
              </div>
              <dl className="ep-cy__facts">
                <div>
                  <dt>Admits into</dt>
                  <dd>
                    {x.academicYear} <span className="ep-cy__sub">({x.code})</span>
                  </dd>
                </div>
                <div>
                  <dt>Registrations</dt>
                  <dd>
                    {day(x.opensAt)} to {day(x.closesAt)}
                  </dd>
                </div>
                <div>
                  <dt>Classes (seats)</dt>
                  <dd>
                    {x.criteria.length
                      ? x.criteria.map((k) => `${k.classCode} (${k.seats})`).join(', ')
                      : 'None yet'}
                  </dd>
                </div>
                <div>
                  <dt>{a('applications')}</dt>
                  <dd>{x.applications}</dd>
                </div>
              </dl>
              <div className="ep-cy__actions">
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/admissions/cycles/${x.id}`}
                  aria-label={`Manage ${x.name}`}
                >
                  Manage classes, forms and fees
                </a>
                {canManage ? (
                  <form action={updateAdmissionCycle}>
                    <input type="hidden" name="id" value={x.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={x.status === 'open' ? 'closed' : 'open'}
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      {x.status === 'open' ? 'Close registrations' : 'Open registrations'}
                    </Button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p className="ep-field__help">
            No admission sessions yet.{canManage ? ' Start one with New session.' : ''}
          </p>
        </Card>
      )}
      {canManage ? (
        <details
          id="new-session"
          className="ep-card ep-cy__new"
          open={cycles.length === 0 || sp.new === '1'}
        >
          <summary>New session</summary>
          <form action={createAdmissionSession} className="ep-cy__form">
            <p className="ep-field__help">
              Name the session and when registrations run. On the next page you add the classes,
              their registration forms, seats and fees.
            </p>
            <FormRow columns={2}>
              <SelectField
                id="academicYearId"
                name="academicYearId"
                label="Admits into the academic year"
                required
                defaultValue={nextYear?.id}
                options={years.map((y) => ({ value: y.id, label: y.code }))}
              />
              <InputField
                id="name"
                name="name"
                label="Name"
                required
                maxLength={120}
                placeholder="Admissions 2027-28"
              />
            </FormRow>
            <FormRow columns={3}>
              <InputField
                id="opensAt"
                name="opensAt"
                label="Registrations open"
                type="datetime-local"
                required
                defaultValue={local(new Date().toISOString())}
              />
              <InputField
                id="closesAt"
                name="closesAt"
                label="Registrations close"
                type="datetime-local"
                required
                defaultValue={local(new Date(Date.now() + 30 * 86_400_000).toISOString())}
              />
              <InputField
                id="applicationFee"
                name="applicationFee"
                label="Registration fee (₹)"
                type="number"
                min={0}
                step="1"
                defaultValue={0}
                help="0 when registration is free"
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="code"
                name="code"
                label="Code (optional)"
                pattern="[A-Za-z0-9-]{2,20}"
                maxLength={20}
                help="Left empty: ADM- and the year, e.g. ADM-2027-28"
              />
            </FormRow>
            <details className="ep-cy__merit">
              <summary>Merit points (optional)</summary>
              <p className="ep-field__help">
                Points added to an application&apos;s score for shortlisting. Untick what this
                session does not use; all but the interaction are worked out from the application.
              </p>
              <div className="ep-cy__merit-row ep-cy__merit-head" aria-hidden="true">
                <span>Counts for</span>
                <span>Points</span>
              </div>
              {MERIT.map((m) => (
                <div key={m.code} className="ep-cy__merit-row">
                  <input type="hidden" name="scoreCode" value={m.code} />
                  <input type="hidden" name="scoreName" value={m.name} />
                  <input type="hidden" name="scoreRule" value={m.rule} />
                  <label className="ep-check">
                    <input type="checkbox" name="scoreOn" value={m.code} defaultChecked />
                    <span>{m.name}</span>
                  </label>
                  <input
                    className="ep-input"
                    name="scorePoints"
                    aria-label={`Points for ${m.name.toLowerCase()}`}
                    type="number"
                    min={0}
                    max={1000}
                    defaultValue={m.points}
                  />
                </div>
              ))}
            </details>
            <FormActions>
              <Button type="submit">Create and set up classes</Button>
            </FormActions>
          </form>
        </details>
      ) : null}
    </>
  );
}
