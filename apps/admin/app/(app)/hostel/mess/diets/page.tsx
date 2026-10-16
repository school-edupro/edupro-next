import { Badge, Button, Card } from '@edupro/ui';
import { MessHeader } from '@/components/hostel/MessHeader';
import { apiFetch, getMe } from '@/lib/api';
import { clearDiet, saveDiet, uploadDiets } from '@/lib/mess-actions';
import { messFile, messHostels, type DietLists } from '@/lib/mess';

interface DietRow {
  studentId: string;
  name: string;
  admissionNo: string | null;
  hostel: string;
  room: string | null;
  diet: string;
  dietName: string;
  noOnionGarlic: boolean;
  allergies: string[];
  notes: string | null;
  allergy: string | null;
  set: boolean;
}
interface DietPage {
  data: DietRow[];
  total: number;
  page: number;
  size: number;
  counts: Array<{ diet: string; name: string; n: number }>;
}
const SIZES = [25, 50, 100, 200];

/**
 * Hostel → Mess → Diet list: every boarder with the diet the hostel keeps (the school's default when none
 * is set), no onion-garlic, the allergies and the allergy on the student record. Filter, page, edit, clear,
 * upload from Excel, download as Excel or PDF.
 */
export default async function MessDietsPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    diet?: string;
    allergy?: string;
    set?: string;
    q?: string;
    page?: string;
    size?: string;
    edit?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const { hostels } = await messHostels();
  const f = {
    hostelId: hostels.some((h) => h.id === sp.hostel) ? sp.hostel! : '',
    diet: /^[a-z][a-z0-9_]{0,29}$/.test(sp.diet ?? '') ? sp.diet! : '',
    allergy: (sp.allergy ?? '').slice(0, 40),
    set: sp.set === 'set' || sp.set === 'unset' ? sp.set : '',
    q: (sp.q ?? '').trim().slice(0, 60),
  };
  const size = SIZES.includes(Number(sp.size)) ? Number(sp.size) : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...f, size: String(size), page: String(page), ...extra }).filter(
          ([, v]) => v,
        ),
      ),
    ).toString();
  const apiQs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...f, page: String(page), size: String(size) }).filter(([, v]) => v),
    ),
  ).toString();
  const [list, lists] = await Promise.all([
    apiFetch<DietPage>(`/hostel/diets?${apiQs}`),
    apiFetch<DietLists>('/hostel/mess/diet-types'),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / size));
  const here = `/hostel/mess/diets?${qs()}`;
  const editing = list.data.find((d) => d.studentId === sp.edit);
  const fileParams = { hostelId: f.hostelId, diet: f.diet, allergy: f.allergy, set: f.set, q: f.q };
  return (
    <>
      <MessHeader
        current="diets"
        permissions={me.permissions}
        hostelId={f.hostelId || undefined}
        sp={sp}
        description="The kitchen’s list: each boarder’s diet, no onion-garlic and allergies, with the allergy written on the student record. Diet types and allergies are set under Mess → Set-up."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={messFile('diets', fileParams, 'xlsx')}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={messFile('diets', fileParams, 'pdf')}
            >
              PDF
            </a>
          </span>
        }
      />
      {editing ? (
        <Card title={`Diet of ${editing.name}`} style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={saveDiet} className="ep-hd__form">
            <input type="hidden" name="studentId" value={editing.studentId} />
            <input type="hidden" name="returnTo" value={here} />
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="de-diet">
                <span className="ep-field__label">Diet</span>
                <select id="de-diet" name="diet" className="ep-select" defaultValue={editing.diet}>
                  {lists.types
                    .filter((t) => t.active || t.code === editing.diet)
                    .map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ep-check" htmlFor="de-nog" style={{ alignSelf: 'end' }}>
                <input
                  id="de-nog"
                  type="checkbox"
                  name="noOnionGarlic"
                  defaultChecked={editing.noOnionGarlic}
                />{' '}
                No onion-garlic
              </label>
              <label className="ep-field" htmlFor="de-notes">
                <span className="ep-field__label">Notes for the kitchen</span>
                <input
                  id="de-notes"
                  name="notes"
                  className="ep-input"
                  maxLength={200}
                  defaultValue={editing.notes ?? ''}
                />
              </label>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Allergies</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
                {lists.allergies
                  .filter((a) => a.active || editing.allergies.includes(a.name))
                  .map((a) => (
                    <label key={a.id} className="ep-check" htmlFor={`de-al-${a.id}`}>
                      <input
                        id={`de-al-${a.id}`}
                        type="checkbox"
                        name="allergy"
                        value={a.name}
                        defaultChecked={editing.allergies.includes(a.name)}
                      />{' '}
                      {a.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            {editing.allergy ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                On the student record: <strong>{editing.allergy}</strong> (shown to the kitchen as
                well).
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Button type="submit">Save the diet</Button>
              <a className="ep-btn ep-btn--ghost" href={`/hostel/mess/diets?${qs()}`}>
                Cancel
              </a>
            </div>
          </form>
          {editing.set ? (
            <form action={clearDiet} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="studentId" value={editing.studentId} />
              <input type="hidden" name="returnTo" value={here} />
              <Button type="submit" variant="ghost" size="sm">
                Back to the school’s default diet
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="df-hostel">
            <span className="ep-field__label">Hostel</span>
            <select id="df-hostel" name="hostel" className="ep-select" defaultValue={f.hostelId}>
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="df-diet">
            <span className="ep-field__label">Diet</span>
            <select id="df-diet" name="diet" className="ep-select" defaultValue={f.diet}>
              <option value="">All</option>
              {lists.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="df-allergy">
            <span className="ep-field__label">Allergy</span>
            <select id="df-allergy" name="allergy" className="ep-select" defaultValue={f.allergy}>
              <option value="">Any</option>
              <option value="_record">Allergy on the student record</option>
              {lists.allergies.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="df-set">
            <span className="ep-field__label">Diet set</span>
            <select id="df-set" name="set" className="ep-select" defaultValue={f.set}>
              <option value="">All</option>
              <option value="set">Set by the hostel</option>
              <option value="unset">On the default</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="df-q">
            <span className="ep-field__label">Pupil</span>
            <input
              id="df-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={f.q}
              placeholder="Name or admission no."
            />
          </label>
          <label className="ep-field" htmlFor="df-size">
            <span className="ep-field__label">Rows per page</span>
            <select id="df-size" name="size" className="ep-select" defaultValue={String(size)}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Show
          </button>
        </form>
      </div>
      <Card
        title={`${String(list.total)} boarder(s)`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            {list.counts.map((c) => (
              <Badge key={c.diet} tone="neutral">
                {c.name} {c.n}
              </Badge>
            ))}
          </span>
        }
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {list.data.length === 0 ? (
          <p>No boarder matches.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Diet list">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Diet list</caption>
              <thead>
                <tr>
                  <th scope="col">Pupil</th>
                  <th scope="col">Hostel · room</th>
                  <th scope="col">Diet</th>
                  <th scope="col">Allergies</th>
                  <th scope="col">Notes</th>
                  <th scope="col">
                    <span className="ep-sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((d) => (
                  <tr key={d.studentId}>
                    <td>
                      <strong>{d.name}</strong>
                      <div className="ep-field__help">{d.admissionNo}</div>
                    </td>
                    <td>
                      {d.hostel}
                      <div className="ep-field__help">{d.room}</div>
                    </td>
                    <td>
                      {d.dietName}
                      {d.noOnionGarlic ? (
                        <div className="ep-field__help">No onion-garlic</div>
                      ) : null}
                      {d.set ? null : <div className="ep-field__help">Default</div>}
                    </td>
                    <td>
                      {d.allergies.map((a) => (
                        <span key={a} style={{ marginRight: 'var(--sp-1)' }}>
                          <Badge tone="danger">{a}</Badge>
                        </span>
                      ))}
                      {d.allergy ? (
                        <div className="ep-field__help">On record: {d.allergy}</div>
                      ) : null}
                      {!d.allergies.length && !d.allergy ? '–' : null}
                    </td>
                    <td>{d.notes ?? '–'}</td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/hostel/mess/diets?${qs({ edit: d.studentId })}`}
                        aria-label={`Edit the diet of ${d.name}`}
                      >
                        Edit
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <nav
            aria-label="Pages"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              marginTop: 'var(--sp-3)',
            }}
          >
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/hostel/mess/diets?${qs({ page: String(page - 1) })}`}
              >
                Previous
              </a>
            ) : null}
            <span className="ep-field__help">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/hostel/mess/diets?${qs({ page: String(page + 1) })}`}
              >
                Next
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
      <Card title="Upload from Excel">
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Download the format: it lists the boarders{f.hostelId ? ' of this hostel' : ''} with what
          is set now. Change the diet, no onion-garlic, allergies (names from the list, separated by
          commas) and notes, and upload it. Every row is checked first; nothing is saved when a row
          has a mistake.
        </p>
        <form action={uploadDiets} className="ep-hd__row">
          <input type="hidden" name="returnTo" value={here} />
          <a
            className="ep-btn ep-btn--secondary"
            href={messFile('diet-template', { hostelId: f.hostelId })}
          >
            Download the format
          </a>
          <label className="ep-field" htmlFor="du-file">
            <span className="ep-field__label">Filled sheet (.xlsx)</span>
            <input
              id="du-file"
              name="file"
              type="file"
              className="ep-input"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
            />
          </label>
          <Button type="submit">Upload</Button>
        </form>
      </Card>
    </>
  );
}
