import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { dmy } from '@/components/hostel/withdrawal-text';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { startHostelWithdrawal } from '@/lib/hostel-withdrawal-actions';

interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  bed: string | null;
}
interface PupilHostel {
  pupil: { id: string; name: string; admissionNo: string; section: string | null };
  current: { place: string; fromDate: string; roomType: string } | null;
}

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Start a hostel withdrawal: find the boarder, then the dates, reason and the parent's letter. */
export default async function NewHostelWithdrawalPage({
  searchParams,
}: {
  searchParams: Promise<{ sq?: string; student?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const sq = (sp.sq ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [me, hits, pupil] = await Promise.all([
    getMe(),
    sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/students?q=${encodeURIComponent(sq)}`).then((r) =>
          r.data.filter((h) => h.bed),
        )
      : Promise.resolve([] as Hit[]),
    studentId
      ? apiFetch<PupilHostel>(`/hostel/students/${studentId}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Hostel', href: '/hostel' },
          { label: 'Withdrawals', href: '/hostel/withdrawals' },
          { label: 'New' },
        ]}
      />
      <PageHeader
        kicker="Hostel withdrawal"
        title="A pupil leaves the hostel"
        description="For a pupil who stays in school. It goes through the approval levels set on Fee setup → Approval levels (Hostel withdrawal), which also say who may start one. A pupil leaving the school is withdrawn from People → Withdrawals; the hostel clears them there."
      />
      <HostelNav current="/hostel/withdrawals" permissions={me.permissions} />
      <Notice params={sp} />
      <Card title="1. The boarder" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="nw-sq">
            <span className="ep-field__label">Name or admission no.</span>
            <input
              id="nw-sq"
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
          hits.length ? (
            <ul className="ep-list" style={{ marginTop: 'var(--sp-3)' }}>
              {hits.map((h) => (
                <li key={h.id}>
                  <a href={`/hostel/withdrawals/new?student=${h.id}`}>
                    {h.name} · {h.admissionNo}
                    {h.section ? ` · ${h.section}` : ''}
                  </a>{' '}
                  <span className="ep-field__help">{h.bed}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-muted">No boarder holding a bed matches “{sq}”.</p>
          )
        ) : null}
      </Card>
      {pupil ? (
        pupil.current ? (
          <Card title={`2. ${pupil.pupil.name} · ${pupil.pupil.admissionNo}`}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {pupil.current.place} ({pupil.current.roomType}) since {dmy(pupil.current.fromDate)}
            </p>
            <form action={startHostelWithdrawal} className="hs-form" style={{ maxWidth: '40rem' }}>
              <input type="hidden" name="studentId" value={pupil.pupil.id} />
              <label className="ep-field" htmlFor="nw-req">
                <span className="ep-field__label">Request received on</span>
                <input
                  id="nw-req"
                  name="requestedOn"
                  type="date"
                  className="ep-input"
                  defaultValue={today()}
                  max={today()}
                />
                <span className="ep-field__help">The notice period is counted from this day.</span>
              </label>
              <label className="ep-field" htmlFor="nw-leave">
                <span className="ep-field__label">Last day in the hostel</span>
                <input
                  id="nw-leave"
                  name="leavingOn"
                  type="date"
                  className="ep-input"
                  required
                  min={pupil.current.fromDate}
                />
                <span className="ep-field__help">
                  Any day from {dmy(pupil.current.fromDate)}, the day the bed was allotted. The
                  hostel fee is charged up to this month; if the day is after the request but sooner
                  than the school’s notice period, the next month is charged too. An earlier day
                  records a pupil who has already left (no notice month).
                </span>
              </label>
              <label className="ep-field" htmlFor="nw-why">
                <span className="ep-field__label">Reason</span>
                <select
                  id="nw-why"
                  name="reason"
                  className="ep-select"
                  defaultValue="parent_request"
                >
                  <option value="parent_request">Parent’s request</option>
                  <option value="health">Health</option>
                  <option value="discipline">Discipline</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Room check and mess</legend>
                <label className="ep-field" htmlFor="nw-dmg">
                  <span className="ep-field__label">Damages to charge (₹)</span>
                  <input
                    id="nw-dmg"
                    name="damageCharge"
                    className="ep-input"
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
                <label className="ep-field" htmlFor="nw-mess">
                  <span className="ep-field__label">Mess dues (₹)</span>
                  <input
                    id="nw-mess"
                    name="messCharge"
                    className="ep-input"
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
                <label className="ep-field" htmlFor="nw-crem">
                  <span className="ep-field__label">About the charges</span>
                  <input
                    id="nw-crem"
                    name="chargeRemarks"
                    className="ep-input"
                    maxLength={500}
                    placeholder="e.g. broken chair; October mess"
                  />
                </label>
                <span className="ep-field__help">
                  Raised as misc fees of the pupil on the last approval.
                </span>
              </fieldset>
              <label className="ep-field" htmlFor="nw-rem">
                <span className="ep-field__label">Remarks</span>
                <textarea
                  id="nw-rem"
                  name="remarks"
                  className="ep-input"
                  rows={3}
                  maxLength={1000}
                />
              </label>
              <label className="ep-field" htmlFor="nw-doc">
                <span className="ep-field__label">
                  Parent’s letter or other documents (optional)
                </span>
                <input
                  id="nw-doc"
                  name="documents"
                  type="file"
                  multiple
                  className="ep-input"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                />
              </label>
              <Button type="submit">Start and send for approval</Button>
            </form>
          </Card>
        ) : (
          <p className="ep-alert ep-alert--info" role="status">
            {pupil.pupil.name} holds no hostel bed.
          </p>
        )
      ) : null}
    </>
  );
}
