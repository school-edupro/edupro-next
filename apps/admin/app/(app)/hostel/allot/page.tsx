import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { allotBed, transferBed, vacateBed } from '@/lib/hostel-actions';

interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  gender: string;
  bed: string | null;
}
interface Stay {
  id: string;
  place: string;
  hostelId: string;
  roomNo: string;
  bed: string;
  roomType: string;
  feeGroup: string | null;
  kind: 'allot' | 'transfer';
  fromDate: string;
  toDate: string | null;
  endReason: string | null;
  remarks: string | null;
  endRemarks: string | null;
}
interface PupilHostel {
  pupil: { id: string; name: string; admissionNo: string; section: string | null; gender: string };
  current: Stay | null;
  wardens: Array<{ name: string; mobile: string | null; isHead: boolean }>;
  history: Stay[];
}
interface FreeBed {
  id: string;
  hostel: string;
  gender: string;
  place: string;
  roomType: string;
  feeGroup: string | null;
}
interface NoBed {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  hostelFrom: string | null;
}

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '—');
const fits = (gender: string, b: FreeBed) =>
  !((b.gender === 'boys' && gender === 'female') || (b.gender === 'girls' && gender === 'male'));

/**
 * Allot a bed to a pupil, move them to another bed or end the stay. Each one changes the hostel fee:
 * hosteller from the month of joining, the room type's fee group month by month, nothing after leaving.
 */
export default async function HostelAllotPage({
  searchParams,
}: {
  searchParams: Promise<{
    sq?: string;
    student?: string;
    bed?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const sq = (sp.sq ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [me, hits, noBed, free, pupil] = await Promise.all([
    getMe(),
    sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/students?q=${encodeURIComponent(sq)}`).then(
          (r) => r.data,
        )
      : Promise.resolve([] as Hit[]),
    apiFetch<{ data: NoBed[] }>('/hostel/no-bed').then((r) => r.data),
    apiFetch<{ data: FreeBed[] }>(`/hostel/free-beds?on=${today()}`).then((r) => r.data),
    studentId
      ? apiFetch<PupilHostel>(`/hostel/students/${studentId}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const preBed = free.find((b) => b.id === sp.bed);
  const here = `/hostel/allot?${new URLSearchParams({
    ...(sq ? { sq } : {}),
    ...(studentId ? { student: studentId } : {}),
  }).toString()}`;
  const beds = pupil ? free.filter((b) => fits(pupil.pupil.gender, b)) : free;
  const bedSelect = (id: string) => (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">Bed</span>
      <select id={id} name="bedId" className="ep-select" required defaultValue={preBed?.id ?? ''}>
        <option value="" disabled>
          Choose a free bed
        </option>
        {beds.map((b) => (
          <option key={b.id} value={b.id}>
            {b.place} — {b.roomType}
          </option>
        ))}
      </select>
      <span className="ep-field__help">
        Free beds today
        {pupil
          ? ` in hostels that take ${pupil.pupil.gender === 'female' ? 'girls' : pupil.pupil.gender === 'male' ? 'boys' : 'the pupil'}`
          : ''}
        . The room type decides the hostel fee.
      </span>
    </label>
  );
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Allot, transfer or vacate"
        description="Find the pupil, then give a bed, move them to another bed, or end the stay. The hostel fee follows at once: from the month of joining, by the room type of each month, and nothing after leaving."
      />
      <HostelNav current="/hostel/allot" permissions={me.permissions} />
      <Notice params={sp} />
      {preBed && !pupil ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          Bed chosen: <strong>{preBed.place}</strong> ({preBed.roomType}). Now find the pupil.
        </div>
      ) : null}
      <Card title="1. The pupil" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          {sp.bed ? <input type="hidden" name="bed" value={sp.bed} /> : null}
          <label className="ep-field" htmlFor="ha-sq">
            <span className="ep-field__label">Name or admission no.</span>
            <input
              id="ha-sq"
              name="sq"
              type="search"
              className="ep-input"
              defaultValue={sq}
              minLength={2}
              required
            />
          </label>
          <Button type="submit" variant="secondary">
            Find
          </Button>
        </form>
        {sq.length >= 2 ? (
          hits.length === 0 ? (
            <p className="ep-field__help">No pupil of this session matches “{sq}”.</p>
          ) : (
            <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-3)' }}>
              <thead>
                <tr>
                  <th scope="col">Pupil</th>
                  <th scope="col">Class</th>
                  <th scope="col">Bed today</th>
                  <th scope="col">
                    <span className="ep-sr-only">Choose</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {hits.map((x) => (
                  <tr key={x.id} aria-current={x.id === studentId ? 'true' : undefined}>
                    <td>
                      {x.name} <small className="ep-field__help">{x.admissionNo}</small>
                    </td>
                    <td>{x.section ?? '—'}</td>
                    <td>{x.bed ?? '—'}</td>
                    <td>
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/hostel/allot?${new URLSearchParams({ sq, student: x.id, ...(sp.bed ? { bed: sp.bed } : {}) }).toString()}`}
                      >
                        Choose
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </Card>

      {pupil ? (
        <Card
          title={`2. ${pupil.pupil.name} · ${pupil.pupil.admissionNo}${pupil.pupil.section ? ` · ${pupil.pupil.section}` : ''}`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {pupil.current ? (
            <>
              <p>
                Holds <strong>{pupil.current.place}</strong> ({pupil.current.roomType}) since{' '}
                {dmy(pupil.current.fromDate)}
                {pupil.current.toDate ? `, leaving on ${dmy(pupil.current.toDate)}` : ''}.
                {pupil.wardens.length
                  ? ` Warden: ${pupil.wardens.map((w) => `${w.name}${w.mobile ? ` (${w.mobile})` : ''}`).join(', ')}.`
                  : ''}
              </p>
              {pupil.current.toDate ? null : (
                <div className="hs-two">
                  <form action={transferBed} className="hs-form">
                    <h3 className="hs-h">Move to another bed</h3>
                    <input type="hidden" name="studentId" value={pupil.pupil.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    {bedSelect('ha-tbed')}
                    <label className="ep-field" htmlFor="ha-ton">
                      <span className="ep-field__label">From</span>
                      <input
                        id="ha-ton"
                        name="onDate"
                        type="date"
                        className="ep-input"
                        required
                        defaultValue={today()}
                      />
                    </label>
                    <label className="ep-field" htmlFor="ha-trem">
                      <span className="ep-field__label">Reason</span>
                      <input id="ha-trem" name="remarks" className="ep-input" maxLength={300} />
                    </label>
                    <Button type="submit">Move</Button>
                  </form>
                  <form action={vacateBed} className="hs-form">
                    <h3 className="hs-h">End the stay</h3>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      A pupil leaving the hostel goes through a{' '}
                      <a href={`/hostel/withdrawals/new?student=${pupil.pupil.id}`}>
                        hostel withdrawal
                      </a>{' '}
                      (warden, mess and accounts clear, damages and the fee settled). End the stay
                      here only to correct a record.
                    </p>
                    <input type="hidden" name="studentId" value={pupil.pupil.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    <label className="ep-field" htmlFor="ha-von">
                      <span className="ep-field__label">Last day in the hostel</span>
                      <input
                        id="ha-von"
                        name="onDate"
                        type="date"
                        className="ep-input"
                        required
                        defaultValue={today()}
                      />
                    </label>
                    <label className="ep-field" htmlFor="ha-vwhy">
                      <span className="ep-field__label">Why</span>
                      <select
                        id="ha-vwhy"
                        name="reason"
                        className="ep-select"
                        defaultValue="vacate"
                      >
                        <option value="vacate">Leaves the hostel (stays in school)</option>
                        <option value="withdrawn">Leaves the school</option>
                      </select>
                    </label>
                    <label className="ep-field" htmlFor="ha-vrem">
                      <span className="ep-field__label">Remarks</span>
                      <input id="ha-vrem" name="remarks" className="ep-input" maxLength={300} />
                    </label>
                    <Button type="submit" variant="secondary">
                      End the stay
                    </Button>
                    <span className="ep-field__help">
                      The hostel fee is charged up to the month of leaving.
                    </span>
                  </form>
                </div>
              )}
            </>
          ) : (
            <form action={allotBed} className="hs-form" style={{ maxWidth: '36rem' }}>
              <input type="hidden" name="studentId" value={pupil.pupil.id} />
              <input type="hidden" name="returnTo" value={here} />
              {bedSelect('ha-bed')}
              <label className="ep-field" htmlFor="ha-from">
                <span className="ep-field__label">From</span>
                <input
                  id="ha-from"
                  name="fromDate"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={today()}
                />
                <span className="ep-field__help">The hostel fee starts from this month.</span>
              </label>
              <label className="ep-field" htmlFor="ha-rem">
                <span className="ep-field__label">Remarks</span>
                <input id="ha-rem" name="remarks" className="ep-input" maxLength={300} />
              </label>
              <Button type="submit">Allot the bed</Button>
            </form>
          )}
          {pupil.history.length ? (
            <>
              <h3 className="hs-h" style={{ marginTop: 'var(--sp-4)' }}>
                Stays
              </h3>
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Bed</th>
                    <th scope="col">Room type</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">How</th>
                  </tr>
                </thead>
                <tbody>
                  {pupil.history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.place}</td>
                      <td>
                        {h.roomType}
                        {h.feeGroup ? (
                          <small className="ep-field__help"> · fee group {h.feeGroup}</small>
                        ) : null}
                      </td>
                      <td>{dmy(h.fromDate)}</td>
                      <td>{dmy(h.toDate)}</td>
                      <td>
                        <Badge tone={h.toDate ? 'neutral' : 'success'}>
                          {h.kind === 'transfer' ? 'Moved in' : 'Allotted'}
                          {h.endReason
                            ? ` · ${h.endReason === 'transfer' ? 'moved out' : h.endReason === 'withdrawn' ? 'left school' : 'left hostel'}`
                            : ''}
                        </Badge>
                        {h.remarks || h.endRemarks ? (
                          <small className="ep-field__help" style={{ display: 'block' }}>
                            {[h.remarks, h.endRemarks].filter(Boolean).join(' · ')}
                          </small>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title={`Hostellers with no bed (${String(noBed.length)})`}>
        <p className="ep-field__help">
          Pupils marked hosteller in their fee profile who hold no bed. Give each a bed here, or all
          at once with the{' '}
          <a href="/hostel/upload" style={{ textDecoration: 'underline' }}>
            Excel upload
          </a>
          .
        </p>
        {noBed.length ? (
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Pupil</th>
                <th scope="col">Class</th>
                <th scope="col">Hosteller from</th>
                <th scope="col">
                  <span className="ep-sr-only">Allot</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {noBed.map((n) => (
                <tr key={n.studentId}>
                  <td>
                    {n.name} <small className="ep-field__help">{n.admissionNo}</small>
                  </td>
                  <td>{n.section ?? '—'}</td>
                  <td>{n.hostelFrom ? dmy(n.hostelFrom) : 'Session start'}</td>
                  <td>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/hostel/allot?student=${n.studentId}`}
                    >
                      Allot a bed
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Every hosteller holds a bed.</p>
        )}
      </Card>
    </>
  );
}
