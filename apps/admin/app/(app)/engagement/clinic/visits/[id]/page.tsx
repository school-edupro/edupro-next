import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { Notice } from '@/components/Notice';
import { RecordSheet } from '@/components/RecordSheet';
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
  const [me, v] = await Promise.all([
    getMe(),
    apiFetch<Visit & { school: string }>(`/clinic/visits/${id}`),
  ]);
  const history = await apiFetch<{ visits: Visit[]; checkups: Checkup[] }>(
    `/clinic/history/${v.audience}/${v.audience === 'student' ? v.studentId! : v.employeeId!}`,
  );
  const here = `/engagement/clinic/visits/${v.id}`;
  const student = v.audience === 'student';
  const manage = me.permissions.includes('engagement.clinic.manage');
  return (
    <>
      <PageHeader
        kicker={`Clinic visit ${v.number}`}
        title={v.student ?? v.employee ?? 'Visit'}
        description={v.complaint}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/clinic/visits">
            Back to the visits
          </a>
        }
      />
      <ClinicNav current="/engagement/clinic/visits" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {!v.outAt && manage ? (
        <Card
          title={
            v.outcome === 'rest'
              ? 'Leaving the clinic: how did the visit end?'
              : 'Still in the clinic'
          }
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <form action={closeClinicVisit} className="ep-hd__form" id="leave">
            <input type="hidden" name="id" value={v.id} />
            <input type="hidden" name="returnTo" value={here} />
            {v.outcome === 'rest' ? (
              <>
                <fieldset className="ep-slots">
                  <legend className="ep-field__label">
                    {student ? 'The pupil' : 'The employee'} was resting. Now:
                  </legend>
                  <div className="ep-slots__grid">
                    {(
                      [
                        ['back_to_class', student ? 'Goes back to class' : 'Goes back to work'],
                        ['sent_home', student ? 'Is sent home (parents are told)' : 'Goes home'],
                        [
                          'referred',
                          student
                            ? 'Is referred to a doctor or hospital (parents are told)'
                            : 'Is referred to a doctor or hospital',
                        ],
                      ] as const
                    ).map(([value, label], i) => (
                      <label key={value} className="ep-slots__slot">
                        <input
                          type="radio"
                          name="outcome"
                          value={value}
                          defaultChecked={i === 0}
                          required
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor="cl-ref">
                    <span className="ep-field__label">Referred to (when referred)</span>
                    <input id="cl-ref" name="referredTo" className="ep-input" maxLength={160} />
                  </label>
                  <label className="ep-field" htmlFor="cl-remark">
                    <span className="ep-field__label">Remark (optional)</span>
                    <input id="cl-remark" name="remark" className="ep-input" maxLength={500} />
                  </label>
                </div>
              </>
            ) : null}
            <div>
              <Button type="submit">Record time out</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <RecordSheet
        school={v.school}
        doc={`Clinic visit · ${v.number}`}
        name={v.student ?? v.employee ?? 'Visit'}
        badge={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={OUTCOME_TONE[v.outcome]}>{v.outcomeLabel}</Badge>
            <Badge tone={v.outAt ? 'neutral' : 'info'}>
              {v.outAt ? `Left ${when(v.outAt)}` : 'In the clinic'}
            </Badge>
          </span>
        }
        facts={[
          [student ? 'Class' : 'Designation', student ? v.section : v.designation],
          [student ? 'Admission no.' : 'Employee code', student ? v.admissionNo : v.employeeCode],
          ['Department', student ? null : v.department],
          ['Time in', when(v.inAt)],
          ['Time out', v.outAt ? when(v.outAt) : null],
          ['Clinic', v.clinic],
          ['Nurse', v.nurse],
        ]}
        sections={[
          {
            title: 'Complaint and examination',
            rows: [
              ['Complaint', v.complaint],
              ['Disease', v.diseases.join(', ') || null],
              ['Temperature', v.temperatureC !== null ? `${String(v.temperatureC)} °C` : null],
              ['Pulse', v.pulse !== null ? `${String(v.pulse)} per minute` : null],
              ['Blood pressure', v.bp],
              ['SpO2', v.spo2 !== null ? `${String(v.spo2)}%` : null],
              ['Weight', v.weightKg !== null ? `${String(v.weightKg)} kg` : null],
              ['Diagnosis', v.diagnosis],
            ],
          },
          {
            title: 'Treatment',
            rows: [
              ['Treatment', v.treatment],
              ['Prescription', v.prescription],
              ['Referred to', v.referredTo],
            ],
          },
          {
            title: 'Record',
            rows: [
              ['Parents told', v.notifiedAt ? when(v.notifiedAt) : null],
              ['Recorded by', v.recordedBy],
            ],
          },
        ]}
        remarksTitle="Remark"
        remarks={v.remark}
        attention={v.outcome === 'sent_home' || v.outcome === 'referred'}
        signedBy={v.doctor}
        signLabel="Doctor"
      >
        {v.medicines.length ? (
          <section className="ep-sheet__sec" aria-label="Medicines given">
            <h3>Medicines given</h3>
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
                      <th scope="row">{medName(m)}</th>
                      <td>
                        {m.qty} {m.unit}
                      </td>
                      <td>{m.dosage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </RecordSheet>
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
                    <a
                      href={`/engagement/clinic/visits/${x.id}`}
                      style={{ textDecoration: 'underline' }}
                    >
                      {x.number}
                    </a>{' '}
                    · {x.complaint}
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
                      href={`/engagement/clinic/cards/${h.id}`}
                      aria-label={`Open the health card of ${h.camp}`}
                    >
                      Open
                    </a>{' '}
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
