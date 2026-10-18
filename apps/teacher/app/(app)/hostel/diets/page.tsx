import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { saveDiet } from '../actions';

interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  room: string;
  diet: string;
  dietName: string;
  noOnionGarlic: boolean;
  allergies: string[];
  notes: string | null;
  allergy: string | null;
}
interface Lists {
  types: Array<{ code: string; name: string; active: boolean }>;
  allergies: Array<{ id: string; name: string; active: boolean }>;
}

/**
 * The kitchen's diet list of a hostel; the warden keeps each boarder's diet and allergies (the school's
 * diet types and allergy list, 0161). The allergy on the student record is shown too.
 */
export default async function DietsPage({
  searchParams,
}: {
  searchParams: Promise<{ hostelId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(sp.hostelId ?? '')) redirect('/hostel');
  let rows: Row[];
  let lists: Lists;
  try {
    [rows, lists] = await Promise.all([
      bff.api
        .fetch<{ data: Row[] }>(`/hostel/diets?hostelId=${sp.hostelId}&size=200`)
        .then((r) => r.data),
      bff.api.fetch<Lists>('/hostel/mess/diet-types'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/hostel');
    throw error;
  }
  const count = (d: string) => rows.filter((r) => r.diet === d).length;
  const DIETS = lists.types.map((x) => [x.code, x.name] as const);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Hostel')}
        title={t(lang, 'Diet list for the kitchen')}
        description={DIETS.filter(([d]) => count(d))
          .map(([d, label]) => `${label}: ${String(count(d))}`)
          .join(' · ')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/hostel">
            {t(lang, 'Hostel desk')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Saved.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card>
        <ul className="fp-rcpts">
          {rows.map((r) => (
            <li key={r.studentId}>
              <span>
                <strong>{r.name}</strong>{' '}
                <span className="ep-field__help">
                  {r.admissionNo} · {t(lang, 'Room')} {r.room}
                </span>
                {[...r.allergies, ...(r.allergy ? [r.allergy] : [])].map((a) => (
                  <span key={a} style={{ display: 'block' }}>
                    <Badge tone="danger">{a}</Badge>
                  </span>
                ))}
              </span>
              <form
                action={saveDiet}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="studentId" value={r.studentId} />
                <input type="hidden" name="hostelId" value={sp.hostelId} />
                <label className="ep-sr-only" htmlFor={`d-${r.studentId}`}>
                  {t(lang, 'Diet')} · {r.name}
                </label>
                <select
                  id={`d-${r.studentId}`}
                  name="diet"
                  className="ep-select"
                  defaultValue={r.diet}
                >
                  {lists.types
                    .filter((x) => x.active || x.code === r.diet)
                    .map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <label style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  <input type="checkbox" name="noOnionGarlic" defaultChecked={r.noOnionGarlic} />
                  {t(lang, 'No onion-garlic')}
                </label>
                {lists.allergies
                  .filter((a) => a.active || r.allergies.includes(a.name))
                  .map((a) => (
                    <label
                      key={a.id}
                      style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        name="allergy"
                        value={a.name}
                        defaultChecked={r.allergies.includes(a.name)}
                      />
                      {a.name}
                    </label>
                  ))}
                <label className="ep-sr-only" htmlFor={`n-${r.studentId}`}>
                  {t(lang, 'Note')} · {r.name}
                </label>
                <input
                  id={`n-${r.studentId}`}
                  name="notes"
                  className="ep-input"
                  placeholder={t(lang, 'Note')}
                  defaultValue={r.notes ?? ''}
                  maxLength={200}
                />
                <Button type="submit" size="sm" variant="secondary">
                  {t(lang, 'Save')}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
