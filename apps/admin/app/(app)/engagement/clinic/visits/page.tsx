import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { timeOf, when } from '@/lib/appointments';
import { closeClinicVisit } from '@/lib/clinic-actions';
import {
  OUTCOMES,
  OUTCOME_TONE,
  medName,
  type ClinicOptions,
  type Outcome,
  type Visit,
} from '@/lib/clinic';

interface VisitList {
  data: Visit[];
  page: { number: number; size: number; total: number };
  counts: { today: number; inClinic: number };
}
const TABS = ['today', 'in_clinic', 'all'] as const;
type Tab = (typeof TABS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;

/**
 * The clinic register: who came today, who is still in the clinic, and everything with filters (pupil or
 * staff, how it ended, doctor, disease, dates, search), pages and Excel.
 */
export default async function ClinicVisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'today';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      tab,
      audience: ['student', 'staff'].includes(sp.audience ?? '') ? sp.audience : undefined,
      outcome: OUTCOMES.some(([o]) => o === sp.outcome) ? sp.outcome : undefined,
      doctorId: ID.test(sp.doctorId ?? '') ? sp.doctorId : undefined,
      diseaseId: ID.test(sp.diseaseId ?? '') ? sp.diseaseId : undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ ...filters, ...extra }).toString();
  const [me, list, options] = await Promise.all([
    getMe(),
    apiFetch<VisitList>(`/clinic/visits?${qs({ page: String(page) })}`),
    apiFetch<ClinicOptions>('/clinic/options'),
  ]);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const here = `/engagement/clinic/visits?${qs({ page: String(page) })}`;
  const manage = me.permissions.includes('engagement.clinic.manage');
  const filtered = Object.keys(filters).length > 1;
  const pick = (kind: string) =>
    options.masters.filter((m) => m.kind === kind).map((m) => ({ value: m.id, label: m.name }));
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Clinic visits"
        description={`${String(list.counts.today)} today · ${String(list.counts.inClinic)} in the clinic now.`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/clinic/visits-report?${qs()}`}
            >
              Excel
            </a>
            {manage ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/clinic/visits/new">
                New visit
              </a>
            ) : null}
          </span>
        }
      />
      <ClinicNav current="/engagement/clinic/visits" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {(
          [
            ['today', `Today · ${String(list.counts.today)}`],
            ['in_clinic', `In the clinic now · ${String(list.counts.inClinic)}`],
            ['all', 'All visits'],
          ] as const
        ).map(([v, label]) => (
          <a
            key={v}
            href={`/engagement/clinic/visits?tab=${v}`}
            aria-current={tab === v ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="tab" value={tab === 'today' ? 'all' : tab} />
          <SelectField
            id="cv-aud"
            name="audience"
            label="For"
            defaultValue={filters.audience ?? ''}
            options={[
              { value: '', label: 'Pupils and staff' },
              { value: 'student', label: 'Pupils' },
              { value: 'staff', label: 'Staff' },
            ]}
          />
          <SelectField
            id="cv-out"
            name="outcome"
            label="Outcome"
            defaultValue={filters.outcome ?? ''}
            options={[
              { value: '', label: 'Any' },
              ...OUTCOMES.map(([value, label]) => ({ value, label })),
            ]}
          />
          <SelectField
            id="cv-doc"
            name="doctorId"
            label="Doctor"
            defaultValue={filters.doctorId ?? ''}
            options={[{ value: '', label: 'Any' }, ...pick('doctor')]}
          />
          <SelectField
            id="cv-dis"
            name="diseaseId"
            label="Disease"
            defaultValue={filters.diseaseId ?? ''}
            options={[{ value: '', label: 'Any' }, ...pick('disease')]}
          />
          <label className="ep-field" htmlFor="cv-from">
            <span className="ep-field__label">From</span>
            <input
              id="cv-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="cv-to">
            <span className="ep-field__label">To</span>
            <input
              id="cv-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <InputField
            id="cv-q"
            name="q"
            type="search"
            label="Visit no., name, admission no., employee code or complaint"
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href={`/engagement/clinic/visits?tab=${tab}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {filtered ? 'Nothing matches these filters.' : 'No visits here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Clinic visits">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Clinic visits, latest first</caption>
              <thead>
                <tr>
                  <th scope="col">Visit</th>
                  <th scope="col">Who</th>
                  <th scope="col">Complaint</th>
                  <th scope="col">Given</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <a href={`/engagement/clinic/visits/${v.id}`}>{v.number}</a>
                      <div className="ep-field__help">
                        {v.audience === 'student' ? 'Pupil' : 'Staff'}
                      </div>
                    </td>
                    <td>
                      {v.student ?? v.employee}
                      <div className="ep-field__help">
                        {v.audience === 'student'
                          ? [v.section, v.admissionNo ? `Adm. no. ${v.admissionNo}` : null]
                              .filter(Boolean)
                              .join(' · ')
                          : [v.employeeCode, v.department].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {v.complaint}
                      <div className="ep-field__help">
                        {[
                          v.diseases.join(', ') || null,
                          v.temperatureC !== null ? `${String(v.temperatureC)} °C` : null,
                          v.doctor,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      {v.medicines.length
                        ? v.medicines.map((m) => `${medName(m)} × ${String(m.qty)}`).join(', ')
                        : '—'}
                    </td>
                    <td>{tab === 'all' ? when(v.inAt) : timeOf(v.inAt)}</td>
                    <td>{v.outAt ? timeOf(v.outAt) : '—'}</td>
                    <td>
                      <Badge tone={OUTCOME_TONE[v.outcome as Outcome]}>{v.outcomeLabel}</Badge>
                      <div className="ep-field__help">
                        {v.outAt ? `Left ${timeOf(v.outAt)}` : 'In the clinic'}
                      </div>
                      {v.referredTo ? <div className="ep-field__help">{v.referredTo}</div> : null}
                      {v.notifiedAt ? <div className="ep-field__help">Parents told</div> : null}
                    </td>
                    <td>
                      <span
                        style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}
                      >
                        {manage && !v.outAt && v.outcome === 'rest' ? (
                          // after resting the clinic says how the visit ended: asked on the visit's page
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/engagement/clinic/visits/${v.id}#leave`}
                            aria-label={`${v.number}: leaving the clinic`}
                          >
                            Leaving
                          </a>
                        ) : manage && !v.outAt ? (
                          <form action={closeClinicVisit}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="returnTo" value={here} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="secondary"
                              aria-label={`Record time out for ${v.number}`}
                            >
                              Time out
                            </Button>
                          </form>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            marginTop: 'var(--sp-3)',
          }}
        >
          {page > 1 ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page - 1) })}`}
            >
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages} · {String(list.page.total)} in all
          </span>
          {page < pages ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page + 1) })}`}
            >
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
