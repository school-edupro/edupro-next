import { Card, PageHeader } from '@edupro/ui';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import { CareerForm } from '@/components/CareerForm';
import {
  careersFetch,
  careersMe,
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
  searchParams: Promise<{ apply?: string; error?: string; detail?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const apply = sp.apply && /^\d{1,18}$/.test(sp.apply) ? sp.apply : '';
  const here = `/${school}/careers/form${apply ? `?apply=${apply}` : ''}`;
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
  const [form, vacancy] = await Promise.all([
    careersFetch<Form>(`/${school}/form`, {}, null),
    apply
      ? careersFetch<CareerVacancy>(`/${school}/vacancies/${apply}`, {}, null).catch(() => null)
      : null,
  ]);
  const applied = vacancy ? me.applications.find((a) => a.vacancyId === vacancy.id) : undefined;
  return (
    <>
      <PageHeader
        kicker="Careers"
        title={vacancy ? `Apply for ${vacancy.title}` : 'Your application'}
        description="Fill it once; the same form is used for every post you apply to."
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
        form={form}
        me={me}
        problem={sp.error ? (sp.detail ?? 'Not done') : null}
      />
    </>
  );
}
