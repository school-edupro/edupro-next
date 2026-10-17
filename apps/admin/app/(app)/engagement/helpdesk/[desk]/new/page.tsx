import { Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { DESK_LABEL, PRIORITY_LABEL } from '@/lib/helpdesk';
import { raiseTicket } from '@/lib/helpdesk-actions';

const MODULES = [
  'admissions',
  'students',
  'attendance',
  'academics',
  'exams',
  'fees',
  'transport',
  'library',
  'communication',
  'helpdesk',
  'payroll',
  'reports',
  'parent app',
  'teacher app',
  'other',
];

interface Board {
  rooms: Array<{
    id: string;
    hostel: string;
    block: string | null;
    roomNo: string;
    beds: Array<{ label: string; studentId: string | null; name?: string; admissionNo?: string }>;
  }>;
}

/**
 * Raise a staff query, a ticket to the ERP provider, or a hostel complaint (about a room of a hostel, and
 * the boarder it concerns when there is one), with attachments.
 */
export default async function RaisePage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: Promise<{ hostel?: string; error?: string; detail?: string }>;
}) {
  const { desk } = await params;
  if (desk !== 'staff' && desk !== 'provider' && desk !== 'hostel') notFound();
  const sp = await searchParams;
  const heads = await apiFetch<{
    data: Array<{ code: string; name: string; description: string }>;
  }>(`/helpdesk/heads/${desk}`);
  // a hostel complaint: the hostel first, then its rooms and boarders
  const hostels =
    desk === 'hostel'
      ? (await apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels')).data
      : [];
  const hostel =
    hostels.find((h) => h.id === sp.hostel) ?? (hostels.length === 1 ? hostels[0] : undefined);
  const board = hostel ? await apiFetch<Board>(`/hostel/board?hostelId=${hostel.id}`) : null;
  const roomName = (r: Board['rooms'][number]) => `${r.block ? `${r.block}-` : ''}${r.roomNo}`;
  const boarders = (board?.rooms ?? []).flatMap((r) =>
    r.beds
      .filter((b) => b.studentId)
      .map((b) => ({
        id: b.studentId!,
        label: `${b.name ?? ''} · ${b.admissionNo ?? ''} · Room ${roomName(r)}/${b.label}`,
      })),
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Helpdesk', href: '/engagement/helpdesk' },
          { label: DESK_LABEL[desk], href: `/engagement/helpdesk/${desk}` },
          { label: 'New' },
        ]}
      />
      <PageHeader
        kicker="Helpdesk"
        title={
          desk === 'provider'
            ? 'Raise a ticket to the ERP provider'
            : desk === 'hostel'
              ? 'Raise a hostel complaint'
              : 'Raise a staff query'
        }
        description={
          desk === 'provider'
            ? 'Describe what happened and attach screenshots. The provider replies here and you are told by mail.'
            : desk === 'hostel'
              ? 'About a room of a hostel (and the boarder, when it concerns one). It goes to the head warden of that hostel, or to the owner set for the complaint type; you are told when it is answered.'
              : 'It goes to the person or role that handles this type of query; you are told when it is answered.'
        }
      />
      <Notice params={sp} />
      {desk === 'hostel' ? (
        <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
          <form method="get" className="ep-dlog__filters">
            <label className="ep-field" htmlFor="rq-hostel">
              <span className="ep-field__label">Hostel</span>
              <select
                id="rq-hostel"
                name="hostel"
                className="ep-select"
                defaultValue={hostel?.id ?? ''}
                required
              >
                <option value="">Choose…</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Choose
            </button>
          </form>
        </div>
      ) : null}
      {desk === 'hostel' && !hostel ? (
        <Card>
          <p>
            {hostels.length
              ? 'Choose the hostel the complaint is about.'
              : 'No hostel is set up yet.'}
          </p>
        </Card>
      ) : (
        <Card>
          <form action={raiseTicket} className="ep-hd__form">
            <input type="hidden" name="desk" value={desk} />
            {hostel ? <input type="hidden" name="hostelId" value={hostel.id} /> : null}
            <SelectField
              id="categoryCode"
              name="categoryCode"
              label="Query type"
              required
              options={[
                { value: '', label: 'Choose…' },
                ...heads.data.map((h) => ({ value: h.code, label: h.name })),
              ]}
            />
            {desk === 'provider' ? (
              <div className="ep-hd__row">
                <SelectField
                  id="priority"
                  name="priority"
                  label="Priority"
                  defaultValue="normal"
                  options={['urgent', 'high', 'normal', 'low'].map((p) => ({
                    value: p,
                    label: PRIORITY_LABEL[p]!,
                  }))}
                />
                <SelectField
                  id="module"
                  name="module"
                  label="ERP module"
                  options={[
                    { value: '', label: '—' },
                    ...MODULES.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) })),
                  ]}
                />
              </div>
            ) : null}
            {desk === 'hostel' && board ? (
              <div className="ep-hd__row">
                <SelectField
                  id="hostelRoomId"
                  name="hostelRoomId"
                  label="Room"
                  options={[
                    { value: '', label: 'Choose… (or the boarder)' },
                    ...board.rooms.map((r) => ({ value: r.id, label: `Room ${roomName(r)}` })),
                  ]}
                />
                <SelectField
                  id="studentId"
                  name="studentId"
                  label="Boarder it concerns (optional)"
                  options={[
                    { value: '', label: '—' },
                    ...boarders.map((b) => ({ value: b.id, label: b.label })),
                  ]}
                />
              </div>
            ) : null}
            <InputField
              id="subject"
              name="subject"
              label="Subject"
              required
              minLength={3}
              maxLength={200}
            />
            <label className="ep-field" htmlFor="body">
              <span className="ep-field__label">Details</span>
              <textarea
                id="body"
                name="body"
                className="ep-input"
                rows={6}
                required
                minLength={3}
                maxLength={5000}
              />
            </label>
            <label className="ep-field" htmlFor="files">
              <span className="ep-field__label">Attachments (optional)</span>
              <input
                id="files"
                name="files"
                type="file"
                className="ep-input"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
              <span className="ep-field__help">PDF or images, up to 5 files of 5 MB each.</span>
            </label>
            <div>
              <Button type="submit">
                {desk === 'provider'
                  ? 'Raise ticket'
                  : desk === 'hostel'
                    ? 'Raise complaint'
                    : 'Raise query'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
