import { Alert, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { deskCreatePass } from '@/lib/gate-pass-actions';

interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
}
interface Guardian {
  relation: string;
  name: string;
  mobileEnd: string | null;
}

/**
 * A pupil's gate pass made at the front desk for a parent who walked in: find the pupil by name or
 * admission number, say who takes the child, and send it for approval (the same levels as a request
 * from the portal).
 */
export default async function NewGatePassPage({
  searchParams,
}: {
  searchParams: Promise<{ sq?: string; student?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const sq = (sp.sq ?? '').trim().slice(0, 80);
  const [me, hits] = await Promise.all([
    getMe(),
    sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/gate-passes/students?q=${encodeURIComponent(sq)}`).then(
          (r) => r.data,
        )
      : Promise.resolve([] as Hit[]),
  ]);
  const student = hits.find((x) => x.id === sp.student) ?? null;
  const guardians = student
    ? (await apiFetch<{ data: Guardian[] }>(`/gate-passes/guardians/${student.id}`)).data
    : [];
  const here = `/engagement/gate-passes/new?${new URLSearchParams({ sq, ...(student ? { student: student.id } : {}) }).toString()}`;
  const onRecord = guardians.filter((g) => ['father', 'mother', 'guardian'].includes(g.relation));
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="New pupil pass"
        description="For a parent at the desk. The pass goes for approval; the child is handed over here once it is approved."
      />
      <GatePassNav current="/engagement/gate-passes/new" permissions={me.permissions} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card title="1. The pupil">
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="np-sq">
            <span className="ep-field__label">Student name or admission no.</span>
            <input
              id="np-sq"
              name="sq"
              type="search"
              className="ep-input"
              defaultValue={sq}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </div>
        </form>
        {sq.length >= 2 && !student ? (
          hits.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Students found">
              <table className="ep-table ep-table--dense">
                <caption>Check the class and the admission number, then select the student</caption>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Admission no.</th>
                    <th scope="col">Class</th>
                    <th scope="col">
                      <span className="ep-sr-only">Select</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td>{x.admissionNo}</td>
                      <td>{x.section ?? '—'}</td>
                      <td>
                        <form method="get">
                          <input type="hidden" name="sq" value={sq} />
                          <Button
                            type="submit"
                            name="student"
                            value={x.id}
                            size="sm"
                            aria-label={`Select ${x.name}, ${x.admissionNo}`}
                          >
                            Select
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Alert tone="warning">No student matches “{sq}”.</Alert>
          )
        ) : null}
        {student ? (
          <Alert tone="success">
            <strong>{student.name}</strong> · {student.section ?? 'no class'} · Adm. no.{' '}
            {student.admissionNo}.{' '}
            <a href={`/engagement/gate-passes/new?sq=${encodeURIComponent(sq)}`}>Change</a>
          </Alert>
        ) : null}
      </Card>
      {student ? (
        <Card title="2. The pass" style={{ marginTop: 'var(--sp-4)' }}>
          <form action={deskCreatePass} className="ep-hd__form">
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="returnTo" value={here} />
            <div className="ep-hd__row">
              <SelectField
                id="np-kind"
                name="kind"
                label="Pass for"
                defaultValue="early_leave"
                options={[
                  { value: 'early_leave', label: 'Leaving early' },
                  { value: 'late_arrival', label: 'Arriving late' },
                ]}
              />
              <label className="ep-field" htmlFor="np-date">
                <span className="ep-field__label">Date (blank = today)</span>
                <input id="np-date" name="onDate" type="date" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="np-time">
                <span className="ep-field__label">Time</span>
                <input id="np-time" name="atTime" type="time" className="ep-input" />
              </label>
            </div>
            <label className="ep-field" htmlFor="np-reason">
              <span className="ep-field__label">Reason</span>
              <input
                id="np-reason"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={300}
              />
            </label>
            <fieldset className="ep-slots">
              <legend className="ep-field__label">
                Who takes the child (not needed for a late arrival)
              </legend>
              <div className="ep-slots__grid">
                {onRecord.map((g) => (
                  <label key={g.relation} className="ep-slots__slot">
                    <input type="radio" name="escortKind" value={g.relation} />
                    <span>
                      {g.name} ({g.relation}
                      {g.mobileEnd ? `, …${g.mobileEnd}` : ''})
                    </span>
                  </label>
                ))}
                <label className="ep-slots__slot">
                  <input type="radio" name="escortKind" value="other" />
                  <span>Someone else</span>
                </label>
              </div>
            </fieldset>
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="np-ename">
                <span className="ep-field__label">Name (someone else)</span>
                <input id="np-ename" name="escortName" className="ep-input" maxLength={120} />
              </label>
              <label className="ep-field" htmlFor="np-erel">
                <span className="ep-field__label">Relation to the child</span>
                <input id="np-erel" name="escortRelation" className="ep-input" maxLength={60} />
              </label>
              <label className="ep-field" htmlFor="np-emob">
                <span className="ep-field__label">Mobile (someone else)</span>
                <input
                  id="np-emob"
                  name="escortMobile"
                  className="ep-input"
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  title="A 10-digit mobile number"
                  maxLength={10}
                />
              </label>
            </div>
            <div>
              <Button type="submit">Send for approval</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
