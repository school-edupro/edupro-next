import { Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { OtpSignIn } from '@/components/OtpSignIn';
import { COOKIE, langOf, publicFetch, t, type Cycle, type FormField } from '@/lib/api';
import { submitApplication } from './actions';

const MESSAGES: Record<string, [string, string]> = {
  'admission.age_criteria': [
    'The date of birth is outside the age window for this class.',
    'जन्म तिथि इस कक्षा की आयु सीमा से बाहर है।',
  ],
  'admission.passcode_invalid': ['The passcode is not correct.', 'पासकोड सही नहीं है।'],
  'admission.duplicate_application': [
    'You already applied for this child in this cycle.',
    'आपने इस चक्र में इस बच्चे के लिए पहले ही आवेदन किया है।',
  ],
  'admission.cycle_closed': ['Applications are closed.', 'आवेदन बंद हैं।'],
  'validation-failed': ['Some answers were not accepted.', 'कुछ उत्तर स्वीकार नहीं हुए।'],
  'applicant-unauthenticated': ['Please sign in again.', 'कृपया फिर से साइन इन करें।'],
};

function Field({ f, lang }: { f: FormField; lang: 'en' | 'hi' }) {
  const label = lang === 'hi' && f.labelHi ? f.labelHi : f.label;
  const id = `f-${f.key}`;
  if (f.type === 'boolean')
    return (
      <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <input type="checkbox" name={f.key} value="1" /> {label}
      </label>
    );
  if (f.type === 'select')
    return (
      <label className="ep-field" htmlFor={id}>
        <span className="ep-field__label">
          {label}
          {f.required ? ' *' : ''}
        </span>
        <select id={id} name={f.key} className="ep-select" required={f.required}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {lang === 'hi' && o.labelHi ? o.labelHi : o.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (f.type === 'textarea')
    return (
      <label className="ep-field" htmlFor={id}>
        <span className="ep-field__label">
          {label}
          {f.required ? ' *' : ''}
        </span>
        <textarea
          id={id}
          name={f.key}
          className="ep-input"
          rows={3}
          required={f.required}
          maxLength={2000}
        />
      </label>
    );
  const type =
    f.type === 'number'
      ? 'number'
      : f.type === 'date'
        ? 'date'
        : f.type === 'email'
          ? 'email'
          : f.type === 'mobile'
            ? 'tel'
            : 'text';
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">
        {label}
        {f.required ? ' *' : ''}
      </span>
      <input
        id={id}
        name={f.key}
        className="ep-input"
        type={type}
        required={f.required}
        min={f.min}
        max={f.max}
        step={f.type === 'number' ? 'any' : undefined}
        maxLength={200}
        pattern={f.type === 'mobile' ? '[6-9][0-9]{9}' : undefined}
      />
    </label>
  );
}

/** The bilingual application form rendered from the cycle's schema (S8-05). */
export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; cycle: string }>;
  searchParams: Promise<{ lang?: string; class?: string; error?: string; detail?: string }>;
}) {
  const { school, cycle: cycleId } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  const cycles = await publicFetch<{ data: Cycle[] }>(`/${school}/cycles`, {}, null).then(
    (r) => r.data,
  );
  const cycle = cycles.find((c) => c.id === cycleId);
  const signedIn = Boolean((await cookies()).get(COOKIE)?.value);
  const here = `/${school}/apply/${cycleId}?class=${sp.class ?? ''}&lang=${lang}`;
  if (!cycle)
    return (
      <>
        <PageHeader
          kicker={school.toUpperCase()}
          title={t(lang, 'Applications closed', 'आवेदन बंद')}
        />
        <Card>{t(lang, 'This admission cycle is not open.', 'यह प्रवेश चक्र खुला नहीं है।')}</Card>
      </>
    );
  const criterion = cycle.criteria.find((k) => k.classId === sp.class) ?? cycle.criteria[0];
  const sections = [...new Set(cycle.formSchema.map((f) => f.section))];
  return (
    <>
      <PageHeader
        kicker={school.toUpperCase()}
        title={lang === 'hi' && cycle.nameHi ? cycle.nameHi : cycle.name}
        description={
          criterion
            ? `${t(lang, 'Class', 'कक्षा')} ${criterion.classCode} · ${t(lang, 'Session', 'सत्र')} ${cycle.academicYear}`
            : ''
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}?lang=${lang}`}>
            {t(lang, 'Back', 'वापस')}
          </a>
        }
      />
      {!signedIn ? (
        <Card title={t(lang, 'Sign in with your mobile', 'अपने मोबाइल से साइन इन करें')}>
          <OtpSignIn school={school} lang={lang} returnTo={here} />
        </Card>
      ) : (
        <>
          {sp.error ? (
            <div
              className="ep-alert ep-alert--danger"
              role="alert"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {(MESSAGES[sp.error] ?? [sp.error, sp.error])[lang === 'hi' ? 1 : 0]}
              {sp.detail ? ` ${sp.detail}` : ''}
            </div>
          ) : null}
          <form action={submitApplication} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="cycleId" value={cycle.id} />
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="schema" value={JSON.stringify(cycle.formSchema)} />
            <Card title={t(lang, 'Child', 'बच्चा')}>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-3)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                }}
              >
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Class', 'कक्षा')} *</span>
                  <select
                    name="classId"
                    className="ep-select"
                    defaultValue={criterion?.classId}
                    required
                  >
                    {cycle.criteria.map((k) => (
                      <option key={k.classId} value={k.classId}>
                        {k.classCode} · {k.className}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'First name', 'पहला नाम')} *</span>
                  <input name="childFirstName" className="ep-input" required maxLength={80} />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Last name', 'उपनाम')}</span>
                  <input name="childLastName" className="ep-input" maxLength={80} />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Date of birth', 'जन्म तिथि')} *</span>
                  <input
                    name="childDob"
                    type="date"
                    className="ep-input"
                    required
                    min={criterion?.dobFrom ?? undefined}
                    max={criterion?.dobTo ?? undefined}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Gender', 'लिंग')}</span>
                  <select name="childGender" className="ep-select">
                    <option value="unspecified">—</option>
                    <option value="male">{t(lang, 'Male', 'पुरुष')}</option>
                    <option value="female">{t(lang, 'Female', 'महिला')}</option>
                    <option value="other">{t(lang, 'Other', 'अन्य')}</option>
                  </select>
                </label>
                {cycle.criteria.some((k) => k.passcode) ? (
                  <label className="ep-field">
                    <span className="ep-field__label">
                      {t(
                        lang,
                        'Passcode (if given by the school)',
                        'पासकोड (यदि विद्यालय ने दिया हो)',
                      )}
                    </span>
                    <input name="passcode" className="ep-input" maxLength={40} />
                  </label>
                ) : null}
              </div>
            </Card>
            {sections.map((section) => (
              <Card
                key={section}
                title={
                  lang === 'hi'
                    ? (cycle.formSchema.find((f) => f.section === section)?.sectionHi ?? section)
                    : section
                }
              >
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--sp-3)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  }}
                >
                  {cycle.formSchema
                    .filter((f) => f.section === section)
                    .map((f) => (
                      <Field key={f.key} f={f} lang={lang} />
                    ))}
                </div>
              </Card>
            ))}
            <div>
              <button type="submit" className="ep-btn">
                {t(lang, 'Submit application', 'आवेदन जमा करें')}
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
