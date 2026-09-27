import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  drawCycle,
  requestCycleApprovals,
  shortlistCycle,
  updateAdmissionCycle,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type {
  AdmissionCriterion,
  AdmissionCycle,
  ClassRow,
  Page,
  ScoreCriterion,
} from '@/lib/types';

const RULES = [
  '',
  'sibling',
  'staff_ward',
  'alumni',
  'single_girl_child',
  'distance_within:5',
  'distance_within:10',
];

export default async function CyclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, a, c, me, cycle, classes] = await Promise.all([
    getTranslations('pages.admissions_cycles'),
    getTranslations('admissions'),
    getTranslations('common'),
    getMe(),
    apiFetch<AdmissionCycle>(`/admissions/cycles/${id}`),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('admissions.cycle.manage');
  const canDecide = me.permissions.includes('admissions.application.review');
  const classOptions = cycle.criteria.map((k) => ({ value: k.classId, label: k.classCode }));
  const local = (iso: string) =>
    new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  const publicBase = process.env.PUBLIC_APP_URL ?? 'http://localhost:3003';
  const rows: Array<AdmissionCriterion | null> = [...cycle.criteria, null, null];
  const scoreRows: Array<ScoreCriterion | null> = [...cycle.scoreCriteria, null];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/admissions' },
          { label: t('title'), href: '/admissions/cycles' },
          { label: cycle.code },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${cycle.code} · ${cycle.name}`}
        description={`${a('session')} ${cycle.academicYear} · ${cycle.applications} ${a('applications').toLowerCase()}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge
              tone={
                cycle.status === 'open'
                  ? 'success'
                  : cycle.status === 'closed'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {a(`statuses.${cycle.status}`)}
            </Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`${publicBase}/${me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolCode.toLowerCase() ?? ''}`}
              target="_blank"
              rel="noreferrer"
            >
              {a('publicLink')}
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <Card title={a('criteria')}>
        <DataTable<AdmissionCriterion>
          caption={a('criteria')}
          density="dense"
          columns={[
            { key: 'class', header: a('class'), render: (k) => <strong>{k.classCode}</strong> },
            { key: 'seats', header: a('seats'), numeric: true, render: (k) => k.seats },
            {
              key: 'dob',
              header: a('dobFrom'),
              render: (k) => `${k.dobFrom ?? '…'} → ${k.dobTo ?? '…'}`,
            },
            {
              key: 'pass',
              header: a('passcode'),
              render: (k) => (k.passcode ? <code>{k.passcode}</code> : ''),
            },
            {
              key: 'apps',
              header: a('applications'),
              numeric: true,
              render: (k) => k.applications,
            },
          ]}
          rows={cycle.criteria}
          rowKey={(k) => k.id}
          emptyTitle={a('noCycles')}
        />
        <DataTable<ScoreCriterion>
          caption={a('scoring')}
          density="dense"
          columns={[
            { key: 'code', header: a('code'), render: (s) => <code>{s.code}</code> },
            { key: 'name', header: a('name'), render: (s) => s.name },
            { key: 'points', header: a('points'), numeric: true, render: (s) => s.points },
            { key: 'rule', header: a('autoRule'), render: (s) => s.autoRule ?? a('manual') },
          ]}
          rows={cycle.scoreCriteria}
          rowKey={(s) => s.id}
          emptyTitle={a('scoring')}
        />
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
          {a('form')}: {cycle.formSchema.length} fields · {a('formHelp')}
        </p>
      </Card>
      {canDecide && cycle.criteria.length ? (
        <Card title={a('decisions')} style={{ marginTop: 'var(--sp-5)' }}>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}
          >
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
      {canManage ? (
        <Card title={a('form')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={updateAdmissionCycle}>
            <input type="hidden" name="id" value={cycle.id} />
            <p className="ep-field__help">{a('formHelp')}</p>
            <label className="ep-field" htmlFor="formSchema">
              <span className="ep-field__label">{a('form')} (JSON)</span>
              <textarea
                id="formSchema"
                name="formSchema"
                className="ep-input"
                rows={14}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)' }}
                defaultValue={JSON.stringify(cycle.formSchema, null, 2)}
              />
            </label>
            <FormActions>
              <Button type="submit" variant="secondary">
                {a('save')}
              </Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
      {canManage ? (
        <Card title={c('save')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={updateAdmissionCycle}>
            <input type="hidden" name="id" value={cycle.id} />
            <FormRow columns={3}>
              <InputField
                id="name"
                name="name"
                label={a('name')}
                defaultValue={cycle.name}
                required
                maxLength={120}
              />
              <InputField
                id="nameHi"
                name="nameHi"
                label={a('nameHi')}
                defaultValue={cycle.nameHi ?? ''}
                maxLength={120}
              />
              <InputField
                id="applicationFee"
                name="applicationFee"
                label={a('applicationFee')}
                type="number"
                min={0}
                defaultValue={Number(cycle.applicationFee)}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="opensAt"
                name="opensAt"
                label={a('opensAt')}
                type="datetime-local"
                defaultValue={local(cycle.opensAt)}
                required
              />
              <InputField
                id="closesAt"
                name="closesAt"
                label={a('closesAt')}
                type="datetime-local"
                defaultValue={local(cycle.closesAt)}
                required
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="instructions"
                name="instructions"
                label={a('instructions')}
                defaultValue={cycle.instructions ?? ''}
                maxLength={5000}
              />
              <InputField
                id="instructionsHi"
                name="instructionsHi"
                label={a('instructionsHi')}
                defaultValue={cycle.instructionsHi ?? ''}
                maxLength={5000}
              />
            </FormRow>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              <strong>{a('criteria')}</strong>
            </p>
            {rows.map((k, i) => (
              <FormRow key={i} columns={4}>
                <SelectField
                  id={`crit-class-${i}`}
                  name="criteriaClassId"
                  label={a('class')}
                  defaultValue={k?.classId ?? ''}
                  options={[
                    { value: '', label: c('none') },
                    ...classes.map((x) => ({ value: x.id, label: x.code })),
                  ]}
                />
                <InputField
                  id={`crit-seats-${i}`}
                  name="criteriaSeats"
                  label={a('seats')}
                  type="number"
                  min={0}
                  defaultValue={k?.seats ?? 40}
                />
                <InputField
                  id={`crit-from-${i}`}
                  name="criteriaDobFrom"
                  label={a('dobFrom')}
                  type="date"
                  defaultValue={k?.dobFrom ?? ''}
                />
                <InputField
                  id={`crit-to-${i}`}
                  name="criteriaDobTo"
                  label={a('dobTo')}
                  type="date"
                  defaultValue={k?.dobTo ?? ''}
                />
                <InputField
                  id={`crit-pass-${i}`}
                  name="criteriaPasscode"
                  label={a('passcode')}
                  defaultValue={k?.passcode ?? ''}
                  maxLength={40}
                />
              </FormRow>
            ))}
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              <strong>{a('scoring')}</strong>
            </p>
            {scoreRows.map((s, i) => (
              <FormRow key={i} columns={4}>
                <InputField
                  id={`sc-code-${i}`}
                  name="scoreCode"
                  label={a('code')}
                  defaultValue={s?.code ?? ''}
                  pattern="[a-z0-9_]*"
                />
                <InputField
                  id={`sc-name-${i}`}
                  name="scoreName"
                  label={a('name')}
                  defaultValue={s?.name ?? ''}
                />
                <InputField
                  id={`sc-points-${i}`}
                  name="scorePoints"
                  label={a('points')}
                  type="number"
                  min={0}
                  defaultValue={s?.points ?? 0}
                />
                <SelectField
                  id={`sc-rule-${i}`}
                  name="scoreRule"
                  label={a('autoRule')}
                  defaultValue={s?.autoRule ?? ''}
                  options={RULES.map((r) => ({ value: r, label: r || a('manual') }))}
                />
              </FormRow>
            ))}
            <FormActions>
              <Button type="submit">{a('save')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
