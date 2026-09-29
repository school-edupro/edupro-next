import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { requestProfileChange, setConsent } from '../queries/actions';

interface Child {
  id: string;
  admissionNo: string;
  name: string;
  dob: string | null;
  gender: string;
  bloodGroup: string | null;
  house: string | null;
  address: Record<string, string>;
  emergencyContact: string | null;
  section: string | null;
  rollNo: number | null;
  classTeacher: string | null;
  route: {
    code: string;
    name: string;
    vehicleNo: string | null;
    stopName: string | null;
    pickupTime: string | null;
    dropTime: string | null;
  } | null;
  guardians: Array<{
    id: string;
    name: string;
    mobile: string | null;
    email: string | null;
    occupation: string | null;
    address: Record<string, string>;
    relation: string;
    isPrimary: boolean;
    isMe: boolean;
  }>;
}
interface Family {
  children: Child[];
  consents: Array<{
    code: string;
    name: string;
    description: string;
    status: 'granted' | 'withdrawn' | null;
    isRequired: boolean;
    recordedAt: string | null;
  }>;
  pendingChangeRequests: number;
}

/** S10: the family profile with change requests and DPDP consents. */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let fam: Family;
  try {
    fam = await bff.api.fetch<Family>('/engagement/family');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 409))
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Profile')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const me = fam.children[0]?.guardians.find((g) => g.isMe);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Profile')}
        title={me?.name ?? t(lang, 'Family')}
        description={`${fam.children.length} ${fam.children.length === 1 ? t(lang, 'child') : t(lang, 'children')}${fam.pendingChangeRequests ? ` · ${fam.pendingChangeRequests} ${t(lang, 'change request(s) awaiting the office')}` : ''}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok === 'consent' ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Your choice has been recorded.')}
        </div>
      ) : sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Change request sent to the school office.')}
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
      {fam.children.map((c) => (
        <Card
          key={c.id}
          title={`${c.name} · ${c.section ?? ''}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 'var(--sp-1) var(--sp-3)',
              margin: 0,
            }}
          >
            <dt className="ep-kicker">{t(lang, 'Admission no')}</dt>
            <dd style={{ margin: 0 }}>{c.admissionNo}</dd>
            <dt className="ep-kicker">{t(lang, 'Roll no')}</dt>
            <dd style={{ margin: 0 }}>{c.rollNo ?? '—'}</dd>
            <dt className="ep-kicker">{t(lang, 'Date of birth')}</dt>
            <dd style={{ margin: 0 }}>{c.dob ?? '—'}</dd>
            <dt className="ep-kicker">{t(lang, 'Blood group')}</dt>
            <dd style={{ margin: 0 }}>{c.bloodGroup ?? '—'}</dd>
            <dt className="ep-kicker">{t(lang, 'House')}</dt>
            <dd style={{ margin: 0 }}>{c.house ?? '—'}</dd>
            <dt className="ep-kicker">{t(lang, 'Class teacher')}</dt>
            <dd style={{ margin: 0 }}>{c.classTeacher ?? '—'}</dd>
            <dt className="ep-kicker">{t(lang, 'Bus')}</dt>
            <dd style={{ margin: 0 }}>
              {c.route
                ? `${c.route.code} · ${c.route.name}${c.route.stopName ? ` · ${c.route.stopName}` : ''}${c.route.pickupTime ? ` · ${t(lang, 'pickup')} ${c.route.pickupTime.slice(0, 5)}` : ''}`
                : t(lang, 'Not using the school bus')}
            </dd>
            <dt className="ep-kicker">{t(lang, 'Emergency contact')}</dt>
            <dd style={{ margin: 0 }}>{c.emergencyContact ?? '—'}</dd>
          </dl>
          <details style={{ marginTop: 'var(--sp-3)' }} open={sp.edit === `student-${c.id}`}>
            <summary className="ep-btn ep-btn--ghost ep-btn--sm">
              {t(lang, 'Request a change to')} {c.name.split(' ')[0]}
              {t(lang, '’s details')}
            </summary>
            <form
              action={requestProfileChange}
              style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}
            >
              <input type="hidden" name="studentId" value={c.id} />
              <input type="hidden" name="entity" value="student" />
              {[
                ['blood_group', t(lang, 'Blood group'), c.bloodGroup],
                ['house', t(lang, 'House'), c.house],
                ['address.line1', t(lang, 'Address line 1'), c.address.line1],
                ['address.city', t(lang, 'City'), c.address.city],
                ['address.pin', t(lang, 'PIN code'), c.address.pin],
                ['details.emergency_contact', t(lang, 'Emergency contact'), c.emergencyContact],
              ].map(([k, label, current]) => (
                <label key={k as string} className="ep-field">
                  <span className="ep-field__label">{label}</span>
                  <input
                    className="ep-input"
                    name={`change.${k}`}
                    placeholder={(current as string | null) ?? ''}
                    maxLength={200}
                  />
                </label>
              ))}
              <input
                className="ep-input"
                name="reason"
                placeholder={t(lang, 'Reason (optional)')}
                maxLength={500}
                aria-label={t(lang, 'Reason')}
              />
              <div>
                <Button type="submit" variant="secondary">
                  {t(lang, 'Send to the office')}
                </Button>
              </div>
            </form>
          </details>
          <h4 style={{ marginTop: 'var(--sp-4)' }}>{t(lang, 'Guardians')}</h4>
          {c.guardians.map((g) => (
            <div key={g.id} style={{ marginBottom: 'var(--sp-2)' }}>
              <strong>{g.name}</strong>{' '}
              {g.isMe ? <Badge tone="info">{t(lang, 'you')}</Badge> : null}{' '}
              {g.isPrimary ? <Badge tone="neutral">{t(lang, 'primary')}</Badge> : null}
              <div className="ep-kicker">
                {g.relation} · {g.mobile ?? '—'} · {g.email ?? '—'}
                {g.occupation ? ` · ${g.occupation}` : ''}
              </div>
              {g.isMe ? (
                <details style={{ marginTop: 'var(--sp-1)' }}>
                  <summary className="ep-btn ep-btn--ghost ep-btn--sm">
                    {t(lang, 'Request a change to my details')}
                  </summary>
                  <form
                    action={requestProfileChange}
                    style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}
                  >
                    <input type="hidden" name="studentId" value={c.id} />
                    <input type="hidden" name="entity" value="guardian" />
                    <input type="hidden" name="entityId" value={g.id} />
                    {[
                      ['mobile', t(lang, 'Mobile'), g.mobile],
                      ['email', t(lang, 'Email'), g.email],
                      ['occupation', t(lang, 'Occupation'), g.occupation],
                      ['address.line1', t(lang, 'Address line 1'), g.address.line1],
                      ['address.city', t(lang, 'City'), g.address.city],
                      ['address.pin', t(lang, 'PIN code'), g.address.pin],
                    ].map(([k, label, current]) => (
                      <label key={k as string} className="ep-field">
                        <span className="ep-field__label">{label}</span>
                        <input
                          className="ep-input"
                          name={`change.${k}`}
                          placeholder={(current as string | null) ?? ''}
                          maxLength={200}
                        />
                      </label>
                    ))}
                    <input
                      className="ep-input"
                      name="reason"
                      placeholder={t(lang, 'Reason (optional)')}
                      maxLength={500}
                      aria-label={t(lang, 'Reason')}
                    />
                    <div>
                      <Button type="submit" variant="secondary">
                        {t(lang, 'Send to the office')}
                      </Button>
                    </div>
                  </form>
                </details>
              ) : null}
            </div>
          ))}
        </Card>
      ))}
      <Card
        title={t(lang, 'Your data')}
        style={{ marginBottom: 'var(--sp-3)' }}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/profile/data">
            {t(lang, 'Open your data')}
          </a>
        }
      >
        <p className="ep-field__help" style={{ margin: 0 }}>
          {t(
            lang,
            'Ask for a copy of the data the school holds, a correction, or raise a grievance.',
          )}
        </p>
      </Card>
      <Card title={t(lang, 'Your consents')} style={{ marginBottom: 'var(--sp-3)' }}>
        <p className="ep-field__help">
          {t(
            lang,
            'Under the Digital Personal Data Protection Act you choose what the school may send you. Fee, attendance and safety messages are always sent.',
          )}
        </p>
        {fam.consents.map((p) => (
          <div
            key={p.code}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              padding: 'var(--sp-2) 0',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div>
                <strong>{p.name}</strong>{' '}
                <Badge
                  tone={
                    p.status === 'granted'
                      ? 'success'
                      : p.status === 'withdrawn'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {p.status ? t(lang, p.status) : t(lang, 'not recorded')}
                </Badge>
              </div>
              <div className="ep-kicker">{p.description}</div>
            </div>
            <form action={setConsent}>
              <input type="hidden" name="purposeCode" value={p.code} />
              <input
                type="hidden"
                name="status"
                value={p.status === 'granted' ? 'withdrawn' : 'granted'}
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={p.isRequired && p.status === 'granted'}
              >
                {p.status === 'granted' ? t(lang, 'Withdraw') : t(lang, 'Allow')}
              </Button>
            </form>
          </div>
        ))}
      </Card>
    </main>
  );
}
