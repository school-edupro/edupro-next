import { Badge } from '@edupro/ui';
import { OpenPortalAs } from '@/components/OpenPortalAs';
import { PhotoUploader } from '@/components/PhotoUploader';
import { Icon } from '@/components/nav-icons';
import { requestEmployeeIdCard } from '@/lib/actions';
import {
  createEmployeeLogin,
  requestEmployeePrint,
  uploadEmployeePhoto,
} from '@/lib/employee-actions';
import type { EmployeeProfile } from '@/lib/employee';
import { ddmmyyyy } from '@/lib/profile';
import type { Employee360 } from '@/lib/types';

export const EMPLOYEE_TABS = [
  ['overview', 'Overview'],
  ['profile', 'Profile'],
  ['education', 'Education'],
  ['languages', 'Languages'],
  ['experience', 'Experience'],
  ['history', 'Transfers and remarks'],
  ['documents', 'Documents'],
  ['posting', 'Posting'],
  ['acr', 'ACR'],
] as const;
export type EmployeeTab = (typeof EMPLOYEE_TABS)[number][0];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
const telHref = (m: string) => `tel:+91${m.replace(/\D/g, '').slice(-10)}`;

/**
 * The top of an employee's page (0188, as the student's page): photo with Add / Change, name, code,
 * job and status, the facts the office looks for first, who to call, profile completeness and the main
 * actions (the office's photo change, the full profile, the PDF, the ID card, the login, Open as…); then
 * the tabs with their counts.
 */
export function EmployeeHero({
  employee,
  profile,
  tab,
  can,
  impersonating,
  openAs,
}: {
  employee: Employee360;
  profile: EmployeeProfile;
  tab: EmployeeTab;
  can: (p: string) => boolean;
  /** this admin app is itself opened as someone: no session inside a session */
  impersonating: boolean;
  /** open the "Open as…" dialog at once */
  openAs: boolean;
}) {
  const v = profile.values;
  const s = (k: string) => {
    const x = v[k];
    return x === null || x === undefined || x === '' ? null : String(x);
  };
  const canEdit = can('people.employee.edit');
  const posting = employee.posting;
  const facts: Array<[string, string | null]> = [
    [
      'Date of birth',
      employee.dob ? `${ddmmyyyy(employee.dob)!}${s('age') ? ` (${s('age')!} yrs)` : ''}` : null,
    ],
    ['Gender', s('gender')],
    ['Blood group', s('blood_group')],
    [
      'Joined on',
      employee.joinedOn
        ? `${ddmmyyyy(employee.joinedOn)!}${s('service_years') ? ` (${s('service_years')!} yrs)` : ''}`
        : null,
    ],
    ['Nature of appointment', s('nature_of_appointment')],
    ['Campus', posting?.campus ?? null],
    ['Reports to', posting?.reportsTo ?? null],
    ['Teaches', profile.subjects.length ? profile.subjects.map((x) => x.name).join(', ') : null],
  ];
  // label, what to show, the mobile to call (shown after the name when it is not the text itself)
  const contacts: Array<[string, string | null, string | null]> = [
    ['Mobile', employee.mobile, employee.mobile],
    ['Email', employee.email, null],
    [
      `Emergency${s('emergency_relation') ? ` (${s('emergency_relation')!})` : ''}`,
      s('emergency_name') ?? s('emergency_mobile'),
      s('emergency_mobile'),
    ],
  ];
  const percent = profile.completeness;
  const counts: Partial<Record<EmployeeTab, { n: number; warn: boolean }>> = {
    education: { n: profile.rows.education.length, warn: false },
    languages: { n: profile.rows.languages.length, warn: false },
    experience: { n: profile.rows.experience.length, warn: false },
    documents: {
      n: profile.documents.missing,
      warn: profile.documents.missing > 0,
    },
  };
  return (
    <>
      <section className="ep-hero" aria-label="Employee summary">
        <div className="ep-hero__photo">
          {employee.photoFileId ? (
            <img
              src={`/api/files/${employee.photoFileId}/view`}
              alt={`Photo of ${employee.displayName}`}
            />
          ) : (
            <span className="ep-hero__initials" aria-hidden="true">
              {initials(employee.displayName)}
            </span>
          )}
          {canEdit ? (
            <PhotoUploader
              action={uploadEmployeePhoto}
              studentId={employee.id}
              label={employee.photoFileId ? 'Change photo' : 'Add photo'}
              fields={{ kind: 'photo' }}
            />
          ) : null}
        </div>
        <div className="ep-hero__main">
          <div className="ep-hero__title">
            <h1>{employee.displayName}</h1>
            <Badge tone={employee.status === 'active' ? 'success' : 'danger'}>
              {employee.status === 'active' ? 'Active' : 'Inactive'}
            </Badge>
            {profile.hasLogin ? (
              <Badge tone="info">Has a login</Badge>
            ) : (
              <Badge tone="neutral">No login</Badge>
            )}
          </div>
          <p className="ep-hero__line">
            Employee code <strong>{employee.employeeCode}</strong>
            {s('staff_type') ? ` · ${s('staff_type')!}` : ''}
            {employee.designation ? ` · ${employee.designation}` : ''}
            {employee.department ? `, ${employee.department}` : ''}
          </p>
          <dl className="ep-hero__facts">
            {facts.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <ul className="ep-hero__parents" aria-label="Contact">
            {contacts
              .filter(([, name]) => name)
              .map(([rel, name, mobile]) => (
                <li key={rel}>
                  <span className="ep-kicker">{rel}</span>{' '}
                  {rel === 'Email' ? (
                    <a href={`mailto:${name!}`}>{name}</a>
                  ) : mobile && mobile === name ? (
                    <a href={telHref(mobile)}>{name}</a>
                  ) : (
                    name
                  )}
                  {mobile && mobile !== name ? (
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
            {profile.missing.length ? (
              <span className="ep-field__help">
                {profile.missing.length} required fields missing
              </span>
            ) : null}
          </div>
          <div className="ep-hero__actions">
            <a
              className="ep-btn ep-btn--primary"
              href={`/people/employees/${employee.id}?tab=profile`}
            >
              {canEdit ? 'Edit full profile' : 'Full profile'}
            </a>
            <form action={requestEmployeePrint}>
              <input type="hidden" name="id" value={employee.id} />
              <input type="hidden" name="tab" value={tab} />
              <button type="submit" className="ep-btn ep-btn--secondary">
                Profile PDF
              </button>
            </form>
            <form action={requestEmployeeIdCard}>
              <input type="hidden" name="id" value={employee.id} />
              <button type="submit" className="ep-btn ep-btn--secondary">
                ID card
              </button>
            </form>
            {!profile.hasLogin && canEdit ? (
              <form action={createEmployeeLogin}>
                <input type="hidden" name="id" value={employee.id} />
                <button type="submit" className="ep-btn ep-btn--ghost">
                  <Icon name="key" size={16} /> Make a staff login
                </button>
              </form>
            ) : null}
            {can('access.portal.view_as') && !impersonating ? (
              <OpenPortalAs
                kind="employee"
                id={employee.id}
                canMakeLogin={canEdit}
                autoOpen={openAs}
                returnTo={`/people/employees/${employee.id}`}
              />
            ) : null}
          </div>
        </div>
      </section>
      <nav
        className="ep-tabs"
        aria-label="Employee sections"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <div className="ep-tabs__list">
          {EMPLOYEE_TABS.map(([k, label]) => {
            const c = counts[k];
            return (
              <a
                key={k}
                className="ep-tabs__tab"
                href={`/people/employees/${employee.id}${k === 'overview' ? '' : `?tab=${k}`}`}
                aria-current={tab === k ? 'page' : undefined}
              >
                {label}
                {c && (c.n || k === 'documents') ? (
                  <span
                    className={`ep-badge ep-badge--${c.warn ? 'warning' : 'neutral'}`}
                    style={{ marginLeft: 'var(--sp-1)' }}
                    aria-label={k === 'documents' ? `${String(c.n)} missing` : undefined}
                  >
                    {c.n}
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}
