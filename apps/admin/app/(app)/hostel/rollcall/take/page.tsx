import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveHostelRollcall } from '@/lib/hostel-actions';

interface Roll {
  session: { id: string; hostel: string; name: string; atTime: string };
  on: string;
  taken: { at: string; by: string | null } | null;
  pupils: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    room: string;
    bed: string;
    away: string | null;
    due: string | null;
    status: 'present' | 'absent' | 'on_leave' | 'sick';
    note: string | null;
  }>;
}

const STATUS = [
  ['present', 'Present'],
  ['absent', 'Absent'],
  ['sick', 'Sick bay'],
] as const;

/**
 * Take the roll of one session from the admin app (as the wardens do in the staff app): every pupil holding
 * a bed, present unless marked otherwise; pupils away on leave are marked by the system.
 */
export default async function TakeRollcallPage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: string;
    on?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(sp.sessionId ?? '')) redirect('/hostel/rollcall');
  const me = await getMe();
  let roll: Roll;
  try {
    roll = await apiFetch<Roll>(
      `/hostel/rollcall?sessionId=${sp.sessionId!}${/^\d{4}-\d{2}-\d{2}$/.test(sp.on ?? '') ? `&on=${sp.on!}` : ''}`,
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      redirect('/hostel/rollcall');
    throw error;
  }
  const day = roll.on.split('-').reverse().join('-');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Hostel', href: '/hostel' },
          { label: 'Roll-call', href: '/hostel/rollcall' },
          { label: `${roll.session.name} · ${day}` },
        ]}
      />
      <PageHeader
        kicker={roll.session.hostel}
        title={`${roll.session.name} roll-call · ${day}`}
        description={
          roll.taken
            ? `Taken by ${roll.taken.by ?? '—'}. You can correct it and save again.`
            : 'Everyone is present unless you mark otherwise. Pupils away on leave are marked by the system.'
        }
      />
      <HostelNav current="/hostel/rollcall" permissions={me.permissions} />
      <Notice params={sp} />
      <form method="get" className="ep-hd__row" style={{ marginBottom: 'var(--sp-3)' }}>
        <input type="hidden" name="sessionId" value={roll.session.id} />
        <label className="ep-field" htmlFor="tr-on">
          <span className="ep-field__label">Day</span>
          <input id="tr-on" name="on" type="date" className="ep-input" defaultValue={roll.on} />
        </label>
        <Button type="submit" variant="secondary">
          Open
        </Button>
      </form>
      {roll.pupils.length === 0 ? (
        <Card>Nobody holds a bed in this hostel on that day.</Card>
      ) : (
        <form action={saveHostelRollcall}>
          <input type="hidden" name="sessionId" value={roll.session.id} />
          <input type="hidden" name="on" value={roll.on} />
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">
                {roll.session.hostel} · {roll.session.name} roll-call
              </caption>
              <thead>
                <tr>
                  <th scope="col">Pupil</th>
                  <th scope="col">Room · Bed</th>
                  <th scope="col">Mark</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {roll.pupils.map((p) => (
                  <tr key={p.studentId}>
                    <td>
                      <input type="hidden" name="studentId" value={p.studentId} />
                      <strong>{p.name}</strong>
                      <div className="ep-field__help">{p.admissionNo}</div>
                    </td>
                    <td>
                      {p.room} · {p.bed}
                    </td>
                    <td>
                      {p.away ? (
                        <>
                          <input type="hidden" name={`s-${p.studentId}`} value="on_leave" />
                          On leave ({p.away}){p.due ? ` · back by ${p.due}` : ''}
                        </>
                      ) : (
                        <fieldset
                          style={{
                            border: 0,
                            padding: 0,
                            margin: 0,
                            display: 'flex',
                            gap: 'var(--sp-3)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <legend className="ep-sr-only">{p.name}</legend>
                          {STATUS.map(([v, label]) => (
                            <label key={v} className="ep-roles__tick">
                              <input
                                type="radio"
                                name={`s-${p.studentId}`}
                                value={v}
                                defaultChecked={p.status === v}
                              />{' '}
                              {label}
                            </label>
                          ))}
                        </fieldset>
                      )}
                    </td>
                    <td>
                      {p.away ? null : (
                        <>
                          <label className="ep-sr-only" htmlFor={`n-${p.studentId}`}>
                            Note for {p.name}
                          </label>
                          <input
                            id={`n-${p.studentId}`}
                            name={`n-${p.studentId}`}
                            className="ep-input"
                            defaultValue={p.note ?? ''}
                            maxLength={200}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'center',
              marginTop: 'var(--sp-3)',
            }}
          >
            <Button type="submit">Save the roll</Button>
            <span className="ep-field__help">
              {roll.pupils.length} boarders. An absence tells the head warden and, by the school’s
              rule, the parent.
            </span>
          </div>
        </form>
      )}
    </>
  );
}
