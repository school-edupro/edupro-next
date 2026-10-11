import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { audienceOf } from '@/components/FamilyShell';
import {
  OnboardingSteps,
  type OnboardingKid,
  type OnboardingLabels,
} from '@/components/OnboardingSteps';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { acknowledge } from './actions';

interface Onboarding {
  notice: { version: number; title: string; body: string; bodyHi: string | null } | null;
  acknowledged: string | null;
  required: boolean;
  purposes: Array<{
    code: string;
    name: string;
    description: string;
    status: 'granted' | 'withdrawn' | null;
    isRequired: boolean;
  }>;
}
/** A student decides only how the school writes to them; the rest is for the parent to give. */
const STUDENT_PURPOSES = /^comms\./;
const ERRORS: Record<string, string> = {
  accept: 'Please tick the box to say you have read the notice.',
  'privacy.version_stale': 'The privacy notice has changed. Please read it again.',
};

/** First visit after sign-in: welcome, the privacy notice and the consent choices (DPDP), in three steps. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let ob: Onboarding;
  let me;
  try {
    [ob, me] = await Promise.all([
      bff.api.fetch<Onboarding>('/engagement/onboarding'),
      bff.api.me(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  if (!ob.notice) redirect('/');
  const audience = audienceOf(me);
  const kids: OnboardingKid[] = await bff.api
    .fetch<{
      children: Array<{
        id: string;
        name: string;
        section: string | null;
        admissionNo: string | null;
        photoFileId: string | null;
      }>;
    }>('/engagement/family')
    .then((r) =>
      r.children.map((k) => ({
        id: k.id,
        name: k.name,
        section: k.section,
        admissionNo: k.admissionNo,
        hasPhoto: Boolean(k.photoFileId),
      })),
    )
    .catch(() => []);
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  const schoolName = school?.schoolName ?? 'EduPro';
  const body = lang === 'hi' && ob.notice.bodyHi ? ob.notice.bodyHi : ob.notice.body;
  let paragraphs = body
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // a notice typed as one long block reads better two sentences at a time (the words are not changed)
  if (paragraphs.length === 1 && paragraphs[0]!.length > 300) {
    const sentences = paragraphs[0]!.match(/[^.!?।]+[.!?।]+(\s|$)|[^.!?।]+$/g) ?? paragraphs;
    paragraphs = [];
    for (let i = 0; i < sentences.length; i += 2)
      paragraphs.push(
        sentences
          .slice(i, i + 2)
          .join('')
          .trim(),
      );
  }
  const purposes = ob.purposes
    .filter((p) => audience === 'parent' || p.isRequired || STUDENT_PURPOSES.test(p.code))
    .map((p) => ({
      code: p.code,
      name: t(lang, p.name),
      description: t(lang, p.description),
      isRequired: p.isRequired,
      granted: p.status === 'granted',
    }));
  const student = audience === 'student';
  const labels: OnboardingLabels = {
    steps: [t(lang, 'Welcome'), t(lang, 'Privacy notice'), t(lang, 'Your choices')],
    stepOf: t(lang, 'Step {n} of 3'),
    welcomeTitle: `${t(lang, 'Namaste')}, ${me.user.displayName}`,
    welcomeLead: t(
      lang,
      student
        ? 'Welcome to your school portal. Two short steps before you start.'
        : 'Welcome to the parent portal of your child’s school. Two short steps before you start.',
    ),
    kidsTitle: t(lang, student ? 'You are signed in as' : 'You are signed in for'),
    admissionNo: t(lang, 'Adm. no.'),
    whatNext: t(lang, 'What happens next'),
    points: [
      t(lang, 'Read how the school uses your information (about one minute).'),
      t(lang, 'Choose which optional messages and services you want.'),
      t(
        lang,
        student
          ? 'Then your timetable, homework, attendance and results open.'
          : 'Then attendance, homework, fees and messages open.',
      ),
    ],
    start: t(lang, 'Start'),
    noticeTitle: t(lang, 'Privacy notice'),
    noticeLead: t(
      lang,
      'Please read this notice from the school. You can ask the school office about any part of it.',
    ),
    version: t(lang, 'Version'),
    next: t(lang, 'Next'),
    back: t(lang, 'Back'),
    choicesTitle: t(lang, 'Your choices'),
    choicesLead: t(
      lang,
      'Nothing optional is switched on for you. Switch on what you agree to; you can leave the rest off.',
    ),
    alwaysOn: t(lang, 'Always on'),
    alwaysTitle: t(lang, 'Fee, attendance and safety messages'),
    alwaysText: t(
      lang,
      'These are needed to run the school and keep children safe, so they are sent regardless.',
    ),
    allowAll: t(lang, 'Allow all'),
    clearAll: t(lang, 'Switch all off'),
    on: t(lang, 'On'),
    off: t(lang, 'Off'),
    accept: t(lang, 'I have read and understood the privacy notice.'),
    finish: t(lang, 'Finish'),
    changeLater: t(lang, 'You can change these choices at any time under Profile.'),
    chosen: t(lang, '{n} of {m} switched on'),
  };
  const initials = schoolName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <main className="fp-ob">
      <div className="fp-ob__wrap">
        <header className="fp-ob__brand">
          <span className="fp-ob__brand-mark" aria-hidden="true">
            {initials}
          </span>
          <span>
            <b>{schoolName}</b>
            <small>{t(lang, student ? 'Student Portal' : 'Parent Portal')}</small>
          </span>
          <nav className="fp-ob__brand-lang" aria-label={t(lang, 'Language')}>
            <a
              className="fp-ob__lang"
              href="/api/lang?to=en&back=/onboarding"
              aria-current={lang === 'en' ? 'true' : undefined}
              lang="en"
            >
              English
            </a>
            <a
              className="fp-ob__lang"
              href="/api/lang?to=hi&back=/onboarding"
              aria-current={lang === 'hi' ? 'true' : undefined}
              lang="hi"
            >
              हिन्दी
            </a>
          </nav>
        </header>
        {sp.error ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            {t(lang, ERRORS[sp.error] ?? 'That could not be saved. Please try again.')}
          </div>
        ) : null}
        <OnboardingSteps
          labels={labels}
          version={ob.notice.version}
          noticeTitle={ob.notice.title}
          paragraphs={paragraphs}
          purposes={purposes}
          kids={kids}
          action={acknowledge}
        />
      </div>
    </main>
  );
}
