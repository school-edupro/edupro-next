import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { closeClinicVisit } from '@/lib/clinic-actions';
import { OUTCOME_TONE, medName, type Checkup, type Visit } from '@/lib/clinic';

/** One clinic visit with everything recorded, and the person's earlier visits and check-ups. */
export default async function ClinicVisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, v] = await Promise.all([getMe(), apiFetch<Visit>(`/clinic/visits/${id}`)]);
  const history = await apiFetch<{ visits: Visit[]; checkups: Checkup[] }>(
    `/clinic/history/${v.audience}/${v.audience === 'student' ? v.studentId! : v.employeeId!}`,
  );
  const here = `/engagement/clinic/visits/${v.id}`;
  const facts: Array<[string, string | null]> = [
    [v.audience === 'student' ? 'Student' : 'Employee', v.who],
    [
      'Designation',
      v.audience === 'staff'
        ? [v.designation, v.department].filter(Boolean).join(' · ') || null
        : null,
    ],
    ['Time in', when(v.inAt)],
    ['Time out', v.outAt ? when(v.outAt) : null],
    ['Clinic', v.clinic],
    ['Doctor', v.doctor],
    ['Nurse', v.nurse],
    ['Complaint', v.complaint],
    ['Disease', v.diseases.join(', ') || null],
    ['Temperature', v.temperatureC !== null ? `${String(v.temperatureC)} °C` : null],
    ['Pulse', v.pulse !== null ? `${String(v.pulse)} per minute` : null],
    ['Blood pressure', v.bp],
    ['SpO2', v.spo2 !== null ? `${String(v.spo2)}%` : null],
    ['Weight', v.weightKg !== null ? `${String(v.weightKg)} kg` : null],
    ['Diagnosis', v.diagnosis],
    ['Treatment', v.treatment],
    ['Prescription', v.prescription],
    ['Remark', v.remark],
    ['Referred to', v.referredTo],
    ['Parents told', v.notifiedAt ? when(v.notifiedAt) : null],
    ['Recorded by', v.recordedBy],
  ];
  return (
    <>
      <PageHeader
        kicker={`Clinic visit ${v.number}`}
        title={v.student ?? v.employee ?? 'Visit'}
        description={v.complaint}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={OUTCOME_TONE[v.outcome]}>{v.outcomeLabel}</Badge>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/clinic/visits">
              Back to the visits
            </a>
          </span>
        }
      />
      <ClinicNav current="/engagement/clinic/visits" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {!v.outAt && me.permissions.includes('engagement.clinic.manage') ? (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={closeClinicVisit} className="ep-gate__act">
            <input type="hidden" name="id" value={v.id} />
            <input type="hidden" name="returnTo" value={here} />
            <span>Still in the clinic.</span>
            <Button type="submit">Record time out</Button>
          </form>
        </Card>
      ) : null}
      <Card title="Details" style={{ marginBottom: 'var(--sp-4)' }}>
        <dl className="ep-hd__facts">
          {facts
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{x}</dd>
              </div>
            ))}
        </dl>
      </Card>
      {v.medicines.length ? (
        <Card title="Medicines given" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Medicines given">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Medicines given at {v.number}</caption>
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Dosage</th>
                </tr>
              </thead>
              <tbody>
                {v.medicines.map((m) => (
                  <tr key={m.id}>
                    <td>{medName(m)}</td>
                    <td>
                      {m.qty} {m.unit}
                    </td>
                    <td>{m.dosage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title={`Earlier at the clinic · ${String(history.visits.length - 1)}`}>
        {history.visits.filter((x) => x.id !== v.id).length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            This is the first visit on record.
          </p>
        ) : (
          <ul className="ep-hd__timeline">
            {history.visits
              .filter((x) => x.id !== v.id)
              .map((x) => (
                <li key={x.id}>
                  <span>
                    <a href={`/engagement/clinic/visits/${x.id}`}>{x.number}</a> · {x.complaint}
                    {x.medicines.length
                      ? ` · ${x.medicines.map((m) => medName(m)).join(', ')}`
                      : ''}{' '}
                    · {x.outcomeLabel}
                  </span>
                  <span className="ep-field__help">{when(x.inAt)}</span>
                </li>
              ))}
          </ul>
        )}
        {history.checkups.length ? (
          <>
            <h3 className="ep-cdash__h3">Health check-ups</h3>
            <ul className="ep-hd__timeline">
              {history.checkups.map((h) => (
                <li key={h.id}>
                  <span>
                    {h.camp}
                    {h.heightCm ? ` · ${String(h.heightCm)} cm` : ''}
                    {h.weightKg ? ` · ${String(h.weightKg)} kg` : ''}
                    {h.bmi ? ` · BMI ${String(h.bmi)}` : ''}
                    {h.bloodGroup ? ` · ${h.bloodGroup}` : ''}
                    {h.remarks ? ` · ${h.remarks}` : ''}{' '}
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/api/clinic/cards/${h.id}`}
                      aria-label={`Download the health card of ${h.camp}`}
                    >
                      PDF
                    </a>
                  </span>
                  <span className="ep-field__help">{h.examDate}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </>
  );
}
