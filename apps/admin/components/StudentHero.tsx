import { Badge } from '@edupro/ui';
import { PhotoUploader } from './PhotoUploader';
import { studentDocumentUpload, requestStudentIdCard } from '@/lib/actions';
import { ddmmyyyy, type ProfileSnapshot } from '@/lib/profile';
import type { Student360 } from '@/lib/types';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile & guardians' },
  { id: 'academics', label: 'Academics' },
  { id: 'documents', label: 'Documents' },
  { id: 'fees', label: 'Fees' },
  { id: 'status', label: 'Status & certificates' },
] as const;
export type StudentTab = (typeof TABS)[number]['id'];
export const STUDENT_TABS: readonly StudentTab[] = TABS.map((t) => t.id);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const telHref = (m: string) => `tel:+91${m.replace(/\D/g, '').slice(-10)}`;

/**
 * The top of a student's page: photo, name, admission and class, the facts people look for first,
 * both parents with tap-to-call numbers, profile completeness and the main actions; then the tabs.
 */
export function StudentHero({
  student,
  profile,
  tab,
  counts,
  can,
}: {
  student: Student360;
  profile: ProfileSnapshot | null;
  tab: StudentTab;
  counts: { documents: number; missingDocuments: number };
  can: (p: string) => boolean;
}) {
  const v = profile?.values ?? {};
  const s = (k: string) => {
    const x = v[k];
    return x === null || x === undefined || x === '' ? null : String(x);
  };
  const e = student.enrolment;
  const percent = profile?.completeness.percent ?? student.profileCompleteness ?? 0;
  const facts: Array<[string, string | null]> = [
    [
      'Date of birth',
      student.dob ? `${ddmmyyyy(student.dob)!}${s('age') ? ` (${s('age')!} yrs)` : ''}` : null,
    ],
    ['Gender', s('gender')],
    ['Blood group', s('blood_group')],
    ['Category', s('category')],
    ['House', s('house')],
    ['Boarding', s('boarding')],
    [
      'Transport',
      s('transport_required') === 'Yes' ? (s('route_no') ?? 'Yes') : s('transport_required'),
    ],
    ['Admitted on', student.admittedOn ? ddmmyyyy(student.admittedOn) : null],
  ];
  const parents: Array<[string, string | null, string | null]> = [
    ['Father', s('father_name'), s('father_mobile')],
    ['Mother', s('mother_name'), s('mother_mobile')],
    ['Guardian', s('guardian_name'), s('guardian_mobile')],
  ];
  return (
    <>
      <section className="ep-hero" aria-label="Student summary">
        <div className="ep-hero__photo">
          {student.photoFileId ? (
            <img
              src={`/api/files/${student.photoFileId}/view`}
              alt={`Photo of ${student.displayName}`}
            />
          ) : (
            <span className="ep-hero__initials" aria-hidden="true">
              {initials(student.displayName)}
            </span>
          )}
          {can('people.student.edit') ? (
            <PhotoUploader
              action={studentDocumentUpload}
              studentId={student.id}
              label={student.photoFileId ? 'Change photo' : 'Add photo'}
            />
          ) : null}
        </div>
        <div className="ep-hero__main">
          <div className="ep-hero__title">
            <h1>{student.displayName}</h1>
            <Badge tone={student.status === 'active' ? 'success' : 'danger'}>
              {student.status}
            </Badge>
          </div>
          <p className="ep-hero__line">
            Admission no <strong>{student.admissionNo}</strong>
            {e ? (
              <>
                {' · '}
                {e.className} {e.section}
                {e.rollNo ? ` · Roll ${String(e.rollNo)}` : ''}
                {` · ${e.academicYear}`}
              </>
            ) : (
              ' · not enrolled in the working year'
            )}
          </p>
          <dl className="ep-hero__facts">
            {facts.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <ul className="ep-hero__parents" aria-label="Parents">
            {parents
              .filter(([, name]) => name)
              .map(([rel, name, mobile]) => (
                <li key={rel}>
                  <span className="ep-kicker">{rel}</span> {name}
                  {mobile ? (
                    <>
                      {' · '}
                      <a href={telHref(mobile)}>{mobile}</a>
                    </>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
        <div className="ep-hero__side">
          <div className="ep-hero__meter">
            <span>
              Profile <strong>{percent}%</strong> complete
            </span>
            <progress
              max={100}
              value={percent}
              aria-label={`Profile ${String(percent)}% complete`}
            />
            {profile && profile.completeness.missing.length ? (
              <span className="ep-field__help">
                {profile.completeness.missing.length} required fields missing
              </span>
            ) : null}
          </div>
          <div className="ep-hero__actions">
            <a className="ep-btn ep-btn--primary" href={`/people/students/${student.id}/profile`}>
              {can('people.student.edit') ? 'Edit full profile' : 'Full profile'}
            </a>
            <form action={requestStudentIdCard}>
              <input type="hidden" name="id" value={student.id} />
              <button
                type="submit"
                className="ep-btn ep-btn--secondary"
               
              >
                ID card
              </button>
            </form>
            {can('fees.ledger.view') ? (
              <a className="ep-btn ep-btn--ghost" href={`/fees/ledger/${student.id}`}>
                Fee ledger
              </a>
            ) : null}
          </div>
        </div>
      </section>
      <nav
        className="ep-tabs"
        aria-label="Student sections"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <div className="ep-tabs__list">
          {TABS.map((t) => (
            <a
              key={t.id}
              className="ep-tabs__tab"
              href={`/people/students/${student.id}?tab=${t.id}`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
              {t.id === 'documents' ? (
                <span
                  className={`ep-badge ep-badge--${counts.missingDocuments ? 'warning' : 'neutral'}`}
                  style={{ marginLeft: 'var(--sp-1)' }}
                >
                  {counts.documents}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
