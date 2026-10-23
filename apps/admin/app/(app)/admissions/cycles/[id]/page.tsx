import {
  Badge,
  Breadcrumbs,
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
import { SessionPlanner } from '@/components/admissions/SessionPlanner';
import { drawCycle, requestCycleApprovals, shortlistCycle } from '@/lib/actions';
import { updateAdmissionSession } from '@/lib/admission-setup-actions';
import type { SessionPlan } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

export default async function CyclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, a, c, me, cycle, plan] = await Promise.all([
    getTranslations('pages.admissions_cycles'),
    getTranslations('admissions'),
    getTranslations('common'),
    getMe(),
    apiFetch<AdmissionCycle>(`/admissions/cycles/${id}`),
    apiFetch<SessionPlan>(`/admissions/cycles/${id}/plan`),
  ]);
  const canManage = me.permissions.includes('admissions.cycle.manage');
  const canDecide = me.permissions.includes('admissions.application.review');
  const classOptions = cycle.criteria.map((k) => ({ value: k.classId, label: k.classCode }));
  const local = (iso: string) =>
    new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/admissions' },
          { label: 'Admission sessions', href: '/admissions/cycles' },
          { label: cycle.code },
        ]}
      />
      <PageHeader
        kicker="Admission session"
        title={`${cycle.name}`}
        description={`${cycle.code} · admits into ${cycle.academicYear} · ${String(cycle.applications)} applications`}
        actions={
          <span className="ep-sp__head">
            <Badge
              tone={
                cycle.status === 'open'
                  ? 'success'
                  : cycle.status === 'closed'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {cycle.status === 'open' ? 'Open' : cycle.status === 'closed' ? 'Closed' : 'Draft'}
            </Badge>
            {canManage ? (
              <form action={updateAdmissionSession}>
                <input type="hidden" name="id" value={cycle.id} />
                <input
                  type="hidden"
                  name="status"
                  value={cycle.status === 'open' ? 'closed' : 'open'}
                />
                <button
                  type="submit"
                  className={`ep-btn ep-btn--sm ${cycle.status === 'open' ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
                >
                  {cycle.status === 'open' ? 'Close registrations' : 'Open registrations'}
                </button>
              </form>
            ) : null}
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={plan.session.url}
              target="_blank"
              rel="noreferrer"
            >
              Public page
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <SessionPlanner plan={plan} canEdit={canManage} />
      {canManage ? (
        <Card title="Session details" style={{ marginTop: 'var(--sp-5)' }}>
          <form action={updateAdmissionSession}>
            <input type="hidden" name="id" value={cycle.id} />
            <FormRow columns={3}>
              <InputField
                id="name"
                name="name"
                label="Name"
                defaultValue={cycle.name}
                required
                maxLength={120}
              />
              <InputField
                id="opensAt"
                name="opensAt"
                label="Registrations open (India time)"
                type="datetime-local"
                defaultValue={local(cycle.opensAt)}
                required
              />
              <InputField
                id="closesAt"
                name="closesAt"
                label="Registrations close (India time)"
                type="datetime-local"
                defaultValue={local(cycle.closesAt)}
                required
              />
            </FormRow>
            <label className="ep-field" htmlFor="instructions">
              <span className="ep-field__label">Instructions on the public page</span>
              <textarea
                id="instructions"
                name="instructions"
                className="ep-input"
                rows={4}
                maxLength={5000}
                defaultValue={cycle.instructions ?? ''}
              />
            </label>
            <FormActions>
              <Button type="submit">{c('save')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
      {canDecide && cycle.criteria.length ? (
        <Card title={a('decisions')} style={{ marginTop: 'var(--sp-5)' }}>
          <div className="ep-sp__decisions">
            <form action={shortlistCycle}>
              <input type="hidden" name="cycleId" value={cycle.id} />
              <p className="ep-field__help">{a('shortlistHelp')}</p>
              <FormRow columns={3}>
                <SelectField
                  id="sl-class"
                  name="classId"
                  label={a('class')}
                  options={classOptions}
                />
                <InputField
                  id="sl-min"
                  name="minScore"
                  label={a('minScore')}
                  type="number"
                  min={0}
                />
                <InputField id="sl-count" name="count" label={a('count')} type="number" min={1} />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {a('shortlist')}
                </Button>
              </FormActions>
            </form>
            <form action={drawCycle}>
              <input type="hidden" name="cycleId" value={cycle.id} />
              <p className="ep-field__help">{a('drawHelp')}</p>
              <FormRow columns={3}>
                <SelectField
                  id="dr-class"
                  name="classId"
                  label={a('class')}
                  options={classOptions}
                />
                <InputField id="dr-seats" name="seats" label={a('seats')} type="number" min={1} />
                <InputField id="dr-seed" name="seed" label={a('seed')} maxLength={40} />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {a('draw')}
                </Button>
              </FormActions>
            </form>
            <form action={requestCycleApprovals}>
              <input type="hidden" name="cycleId" value={cycle.id} />
              <p className="ep-field__help">{a('approval')}</p>
              <FormRow columns={2}>
                <SelectField
                  id="ap-class"
                  name="classId"
                  label={a('class')}
                  options={[{ value: '', label: c('all') }, ...classOptions]}
                />
              </FormRow>
              <FormActions>
                <Button type="submit">{a('requestApprovals')}</Button>
              </FormActions>
            </form>
          </div>
        </Card>
      ) : null}
    </>
  );
}
