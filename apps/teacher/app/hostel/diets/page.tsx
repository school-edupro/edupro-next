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
  noOnionGarlic: boolean;
  notes: string | null;
  allergy: string | null;
}
const DIETS = [
  ['veg', 'Vegetarian'],
  ['eggetarian', 'Vegetarian with egg'],
  ['non_veg', 'Non-vegetarian'],
  ['jain', 'Jain'],
  ['vegan', 'Vegan'],
] as const;

/** The kitchen's diet list of a hostel; the warden keeps each boarder's diet. Allergy comes from the student record. */
export default async function DietsPage({
  searchParams,
}: {
  searchParams: Promise<{ hostelId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(sp.hostelId ?? '')) redirect('/hostel');
  let rows: Row[];
  try {
    rows = (await bff.api.fetch<{ data: Row[] }>(`/hostel/diets?hostelId=${sp.hostelId}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/hostel');
    throw error;
  }
  const count = (d: string) => rows.filter((r) => r.diet === d).length;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Hostel')}
        title={t(lang, 'Diet list for the kitchen')}
        description={DIETS.filter(([d]) => count(d))
          .map(([d, label]) => `${t(lang, label)}: ${String(count(d))}`)
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
                {r.allergy ? (
                  <span style={{ display: 'block' }}>
                    <Badge tone="danger">{r.allergy}</Badge>
                  </span>
                ) : null}
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
                  {DIETS.map(([d, label]) => (
                    <option key={d} value={d}>
                      {t(lang, label)}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  <input type="checkbox" name="noOnionGarlic" defaultChecked={r.noOnionGarlic} />
                  {t(lang, 'No onion-garlic')}
                </label>
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
