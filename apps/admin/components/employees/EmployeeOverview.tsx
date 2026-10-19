import { Badge, Card } from '@edupro/ui';
import type { EmployeeCatalogue, EmployeeProfile } from '@/lib/employee';
import { applies, ddmmyyyy } from '@/lib/profile';
import type { Employee360 } from '@/lib/types';

const dmy = (d: string | null) => (d ? ddmmyyyy(d) : null);

/**
 * The Overview tab of an employee's page (0188, as the student's): the profile by section at a glance
 * with what is missing, the current posting, the documents for employment, education and work in
 * short, and who approves their ACR and requests. Every card links to where it is changed.
 */
export function EmployeeOverview({
  employee,
  profile,
  catalogue,
  canAcr,
}: {
  employee: Employee360;
  profile: EmployeeProfile;
  catalogue: EmployeeCatalogue;
  canAcr: boolean;
}) {
  const v = profile.values;
  const base = `/people/employees/${employee.id}`;
  const dateKeys = new Set(catalogue.fields.filter((f) => f.type === 'date').map((f) => f.key));
  const show = (k: string): string | null => {
    const x = v[k];
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'boolean') return x ? 'Yes' : 'No';
    if (k.startsWith('acr_hod') || k.startsWith('approver_'))
      return profile.approvers[String(x)] ?? String(x);
    return dateKeys.has(k) ? ddmmyyyy(String(x)) : String(x);
  };
  const missing = new Set(profile.missing);
  const edit = (
    <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${base}?tab=profile`}>
      Edit
    </a>
  );
  // a section card: the fields that apply, filled ones first, required empty ones named
  const section = (id: string, title: string, max = 12) => {
    const fields = catalogue.fields.filter(
      (f) => f.section === id && applies(f, v) && (show(f.key) || missing.has(f.key)),
    );
    if (!fields.length) return null;
    const rows = fields.slice(0, max);
    return (
      <Card key={id} title={title} actions={edit}>
        <dl className="ep-facts">
          {rows.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{show(f.key) ?? <span className="ep-field__help">not filled</span>}</dd>
            </div>
          ))}
        </dl>
        {fields.length > rows.length ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            <a href={`${base}?tab=profile`}>
              {fields.length - rows.length} more on the full profile
            </a>
          </p>
        ) : null}
      </Card>
    );
  };
  const posting = employee.posting;
  const docs = profile.documents;
  const education = profile.rows.education;
  const experience = profile.rows.experience;
  const titles = new Map(catalogue.sections.map((s) => [s.id, s.title]));
  return (
    <div className="ep-grid-cards">
      <Card
        title="Posting"
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${base}?tab=posting`}>
            Posting
          </a>
        }
      >
        <dl className="ep-facts">
          <div>
            <dt>Designation</dt>
            <dd>{posting?.designation ?? employee.designation ?? '—'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{posting?.department ?? employee.department ?? '—'}</dd>
          </div>
          <div>
            <dt>Campus</dt>
            <dd>{posting?.campus ?? '—'}</dd>
          </div>
          <div>
            <dt>Reports to</dt>
            <dd>
              {posting?.reportsToEmployeeId ? (
                <a href={`/people/employees/${posting.reportsToEmployeeId}`}>{posting.reportsTo}</a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Valid</dt>
            <dd>
              {posting
                ? `${dmy(posting.validFrom)!} → ${posting.validTo ? dmy(posting.validTo)! : 'open'}`
                : '—'}
            </dd>
          </div>
          {employee.directReports.length ? (
            <div>
              <dt>Direct reports</dt>
              <dd>
                {employee.directReports.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 ? ', ' : ''}
                    <a href={`/people/employees/${d.id}`}>{d.displayName}</a>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>
      <Card
        title="Documents for employment"
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${base}?tab=documents`}>
            Documents
          </a>
        }
      >
        <p style={{ marginTop: 0 }}>
          {docs.missing ? (
            <Badge tone="warning">
              {docs.missing} of {docs.required} required missing or expired
            </Badge>
          ) : (
            <Badge tone="success">All {docs.required} required documents on file</Badge>
          )}{' '}
          {docs.unverified ? <Badge tone="neutral">{docs.unverified} not yet checked</Badge> : null}
        </p>
        <ul className="ep-acr-events" style={{ margin: 0 }}>
          {docs.types
            .filter((d) => d.required && !d.done)
            .slice(0, 6)
            .map((d) => (
              <li key={d.typeId}>
                {d.name}
                <span className="ep-field__help">
                  {' '}
                  · {d.files.some((f) => f.expired) ? 'expired' : 'missing'}
                </span>
              </li>
            ))}
        </ul>
      </Card>
      <Card
        title="Education and work"
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${base}?tab=education`}>
            Education
          </a>
        }
      >
        <dl className="ep-facts">
          <div>
            <dt>Qualifications</dt>
            <dd>
              {education.length
                ? education
                    .map(
                      (e) =>
                        `${e.qualification}${e.specialisation ? ` (${e.specialisation})` : ''}${e.passingYear ? `, ${String(e.passingYear)}` : ''}`,
                    )
                    .join('; ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>
              {profile.rows.languages.length
                ? profile.rows.languages.map((l) => l.language).join(', ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Earlier work</dt>
            <dd>
              {experience.length
                ? experience
                    .map(
                      (x) =>
                        `${x.organisation}${x.designation ? ` (${x.designation})` : ''}${x.fromOn || x.toOn ? `, ${dmy(x.fromOn) ?? '…'} to ${dmy(x.toOn) ?? 'now'}` : ''}`,
                    )
                    .join('; ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Training</dt>
            <dd>
              {profile.rows.training?.length
                ? profile.rows.training
                    .slice(0, 4)
                    .map((x) => `${x.topic}${x.trainedOn ? ` (${dmy(x.trainedOn)!})` : ''}`)
                    .join('; ') +
                  (profile.rows.training.length > 4
                    ? ` and ${String(profile.rows.training.length - 4)} more`
                    : '')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Teaches</dt>
            <dd>
              {profile.subjects.length ? profile.subjects.map((x) => x.name).join(', ') : '—'}
            </dd>
          </div>
        </dl>
      </Card>
      {section('basic', titles.get('basic') ?? 'Basic information')}
      {section('contact', titles.get('contact') ?? 'Contact and emergency')}
      {section('address', titles.get('address') ?? 'Address')}
      {section('employment', titles.get('employment') ?? 'Employment')}
      {section('statutory', titles.get('statutory') ?? 'Statutory')}
      {section('govt_ids', titles.get('govt_ids') ?? 'Identity documents')}
      {section('bank', titles.get('bank') ?? 'Bank details')}
      {canAcr ? section('approvers', titles.get('approvers') ?? 'Approvers') : null}
    </div>
  );
}
