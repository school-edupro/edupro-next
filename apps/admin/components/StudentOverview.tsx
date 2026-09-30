import { Card } from '@edupro/ui';
import { ddmmyyyy, type ProfileCatalogue, type ProfileSnapshot } from '@/lib/profile';
import type { Student360 } from '@/lib/types';

/** Key profile facts at a glance, grouped the way the office asks for them, with what is missing. */
export function StudentOverview({
  student,
  profile,
  catalogue,
}: {
  student: Student360;
  profile: ProfileSnapshot;
  catalogue: ProfileCatalogue;
}) {
  const v = profile.values;
  const label = new Map(catalogue.fields.map((f) => [f.key, f.label]));
  const section = new Map(catalogue.fields.map((f) => [f.key, f.section]));
  const dateKeys = new Set(catalogue.fields.filter((f) => f.type === 'date').map((f) => f.key));
  const show = (k: string) => {
    const x = v[k];
    if (x === null || x === undefined || x === '') return null;
    return dateKeys.has(k) ? ddmmyyyy(String(x)) : String(x);
  };
  const block = (title: string, keys: string[], tab?: string) => {
    const rows = keys.map((k) => [label.get(k) ?? k, show(k)] as const);
    return (
      <Card
        title={title}
        actions={
          tab ? (
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/people/students/${student.id}/profile?tab=${tab}`}
            >
              Edit
            </a>
          ) : undefined
        }
      >
        <dl className="ep-facts">
          {rows.map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val ?? <span className="ep-field__help">not filled</span>}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  };
  const address = [
    show('residential_address_line_1'),
    show('residential_address_line_2'),
    show('residential_city'),
    show('residential_state'),
    show('residential_pin_code'),
  ]
    .filter(Boolean)
    .join(', ');
  const missing = profile.completeness.missing;
  return (
    <div className="ep-grid-cards">
      {block(
        'Personal',
        [
          'dob',
          'gender',
          'blood_group',
          'religion',
          'category',
          'nationality',
          'mother_tongue',
          'aadhaar_no',
          'apaar_id',
          'pen_no',
        ],
        'student',
      )}
      <Card
        title="Contact and address"
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/people/students/${student.id}/profile?tab=address`}
          >
            Edit
          </a>
        }
      >
        <dl className="ep-facts">
          <div>
            <dt>Residential address</dt>
            <dd>{address || <span className="ep-field__help">not filled</span>}</dd>
          </div>
          {(
            [
              'sms_mobile',
              'whatsapp_no',
              'primary_email',
              'emergency_contact_name',
              'emergency_contact_mobile',
            ] as const
          ).map((k) => (
            <div key={k}>
              <dt>{label.get(k)}</dt>
              <dd>{show(k) ?? <span className="ep-field__help">not filled</span>}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {block(
        'Parents',
        [
          'father_name',
          'father_mobile',
          'father_email',
          'father_occupation',
          'mother_name',
          'mother_mobile',
          'mother_email',
          'mother_occupation',
        ],
        'father',
      )}
      {block(
        'Academic and previous school',
        [
          'admitted_on',
          'registration_no',
          'boarding',
          'stream',
          'previous_school_name',
          'previous_school_board',
          'last_class_attended',
          'tc_no',
        ],
        'academic',
      )}
      {block(
        'Transport and health',
        [
          'transport_required',
          'travel_mode',
          'route_no',
          'cwsn',
          'type_of_disability',
          'medical_condition',
        ],
        'transport_health',
      )}
      <Card
        title={
          missing.length ? `Missing information (${String(missing.length)})` : 'Missing information'
        }
      >
        {missing.length ? (
          <ul className="ep-missing">
            {missing.map((k) => (
              <li key={k}>
                <a
                  href={`/people/students/${student.id}/profile?tab=${section.get(k) ?? 'student'}`}
                >
                  {label.get(k) ?? k}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>Every required field is filled in.</p>
        )}
        {student.siblings.length ? (
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <span className="ep-kicker">Siblings in school</span>{' '}
            {student.siblings.map((sib, i) => (
              <span key={sib.id}>
                {i > 0 ? ', ' : ''}
                <a href={`/people/students/${sib.id}`}>{sib.displayName}</a> ({sib.admissionNo})
              </span>
            ))}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
