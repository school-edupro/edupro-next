import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import { CareerForm } from '@/components/CareerForm';
import {
  careersFetch,
  careersMe,
  dmy,
  istText,
  type CareerForm as Form,
  type CareerSignIn,
  type CareerVacancy,
} from '@/lib/careers';

/**
 * The application on the careers page (docs/design/34-recruitment.md): sign in with a code, then the
 * step form, filled once and used for every post; with `?apply=` it ends with applying for that post.
 */
export default async function CareerFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ apply?: string; correct?: string; error?: string; detail?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const apply = sp.apply && /^\d{1,18}$/.test(sp.apply) ? sp.apply : '';
  const correctId = sp.correct && /^\d{1,18}$/.test(sp.correct) ? sp.correct : '';
  const here = `/${school}/careers/form${apply ? `?apply=${apply}` : correctId ? `?correct=${correctId}` : ''}`;
  const me = await careersMe(school);
  if (!me) {
    const channels = await careersFetch<CareerSignIn>(`/${school}/sign-in`, {}, null);
    return (
      <>
        <PageHeader kicker="Careers" title="Your application" />
        <Card title="Sign in">
          <CandidateSignIn school={school} returnTo={here} channels={channels} />
        </Card>
      </>
    );
  }
  // a correction the school asked for (part 8): only the parts marked, then sent again
  const returned = correctId ? me.applications.find((a) => a.id === correctId) : undefined;
  if (correctId && !returned?.correction) redirect(`/${school}/careers/mine`);
  const correct = returned?.correction
    ? {
        id: returned.id,
        number: returned.number,
        title: returned.title,
        ...returned.correction,
        dueText: dmy(returned.correction.dueOn),
      }
    : null;
  const [form, vacancy] = await Promise.all([
    careersFetch<Form>(`/${school}/form`, {}, null),
    apply && !correct
      ? careersFetch<CareerVacancy>(`/${school}/vacancies/${apply}`, {}, null).catch(() => null)
      : null,
  ]);
  const applied = vacancy ? me.applications.find((a) => a.vacancyId === vacancy.id) : undefined;
  return (
    <>
      <PageHeader
        kicker="Careers"
        title={
          correct
            ? `Correct application ${correct.number}`
            : vacancy
              ? `Apply for ${vacancy.title}`
              : 'Your application'
        }
        description={
          correct
            ? `${correct.title}: change the parts the school marked, then send the application again.`
            : 'Fill it once; the same form is used for every post you apply to.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/careers/mine`}>
            My applications
          </a>
        }
      />
      <CareerForm
        school={school}
        apply={apply}
        vacancy={
          vacancy
            ? { id: vacancy.id, title: vacancy.title, closesText: istText(vacancy.closesAt) }
            : null
        }
        applied={applied?.number ?? null}
        correct={correct}
        form={form}
        me={me}
        problem={sp.error ? (sp.detail ?? 'Not done') : null}
      />
    </>
  );
}
