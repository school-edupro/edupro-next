import { Button } from '@edupro/ui';
import { apiFetch } from '@/lib/api';
import { raiseTicket } from '@/lib/helpdesk-actions';

interface Board {
  rooms: Array<{
    id: string;
    block: string | null;
    roomNo: string;
    beds: Array<{ label: string; studentId: string | null; name?: string; admissionNo?: string }>;
  }>;
}

/**
 * The one form for a hostel complaint, on Hostel → Complaints and on Helpdesk → Hostel complaints: the
 * hostel first, then the room and / or the boarder it concerns, the complaint type, priority, subject,
 * details and photos / PDFs. It raises the helpdesk ticket and opens it (saying who it went to).
 * `pickerPath` is the page the hostel choice reloads; `keep` its other query values.
 */
export async function HostelComplaintForm({
  hostelId,
  pickerPath,
  keep = {},
}: {
  hostelId?: string;
  pickerPath: string;
  keep?: Record<string, string>;
}) {
  const [hostels, heads] = await Promise.all([
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels').then((r) => r.data),
    apiFetch<{ data: Array<{ code: string; name: string }> }>('/helpdesk/heads/hostel').then(
      (r) => r.data,
    ),
  ]);
  const hostel =
    hostels.find((h) => h.id === hostelId) ?? (hostels.length === 1 ? hostels[0] : undefined);
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
  const back = `${pickerPath}?${new URLSearchParams({ ...keep, ...(hostel ? { hostel: hostel.id } : {}) }).toString()}`;
  return (
    <>
      <form
        method="get"
        action={pickerPath}
        className="ep-hd__row"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="ep-field" htmlFor="hcf-hostel">
          <span className="ep-field__label">Hostel</span>
          <select
            id="hcf-hostel"
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
      {!hostel || !board ? (
        <p className="ep-field__help">
          {hostels.length
            ? 'Choose the hostel the complaint is about.'
            : 'No hostel is set up yet.'}
        </p>
      ) : (
        <form action={raiseTicket} className="ep-hd__form">
          <input type="hidden" name="desk" value="hostel" />
          <input type="hidden" name="hostelId" value={hostel.id} />
          <input type="hidden" name="returnTo" value={back} />
          <div className="ep-hd__row">
            <label className="ep-field" htmlFor="hcf-room">
              <span className="ep-field__label">Room</span>
              <select id="hcf-room" name="hostelRoomId" className="ep-select" defaultValue="">
                <option value="">Choose… (or the boarder)</option>
                {board.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {roomName(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="hcf-pupil">
              <span className="ep-field__label">Boarder it concerns (optional)</span>
              <select id="hcf-pupil" name="studentId" className="ep-select" defaultValue="">
                <option value="">—</option>
                {boarders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ep-hd__row">
            <label className="ep-field" htmlFor="hcf-head">
              <span className="ep-field__label">Complaint type *</span>
              <select
                id="hcf-head"
                name="categoryCode"
                className="ep-select"
                required
                defaultValue=""
              >
                <option value="">Choose…</option>
                {heads.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="hcf-prio">
              <span className="ep-field__label">Priority</span>
              <select id="hcf-prio" name="priority" className="ep-select" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label className="ep-field" htmlFor="hcf-subj">
            <span className="ep-field__label">Subject *</span>
            <input
              id="hcf-subj"
              name="subject"
              className="ep-input"
              required
              minLength={3}
              maxLength={200}
            />
          </label>
          <label className="ep-field" htmlFor="hcf-body">
            <span className="ep-field__label">Details *</span>
            <textarea
              id="hcf-body"
              name="body"
              className="ep-input"
              rows={4}
              required
              minLength={3}
              maxLength={5000}
            />
          </label>
          <label className="ep-field" htmlFor="hcf-files">
            <span className="ep-field__label">Photos or documents (optional)</span>
            <input
              id="hcf-files"
              name="files"
              type="file"
              className="ep-input"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
            />
            <span className="ep-field__help">PDF or images, up to 5 files of 5 MB each.</span>
          </label>
          <p className="ep-field__help" style={{ margin: 0 }}>
            Choose the room, the boarder, or both. It goes to the head warden of the hostel, or to
            the owner set for the complaint type (Helpdesk set-up).
          </p>
          <div>
            <Button type="submit">Raise complaint</Button>
          </div>
        </form>
      )}
    </>
  );
}
