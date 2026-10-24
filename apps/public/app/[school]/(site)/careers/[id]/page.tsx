import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import { PublicApiError } from '@/lib/api';
import {
  careersFetch,
  careersMe,
  dmy,
  istText,
  type CareerSignIn,
  type CareerVacancy,
} from '@/lib/careers';

/** One open vacancy: what it asks for, then sign in and apply. */
export default async function CareerVacancyPage({
  params,
}: {
  params: Promise<{ school: string; id: string }>;
}) {
  const { school, id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const v = await careersFetch<CareerVacancy>(`/${school}/vacancies/${id}`, {}, null).catch(
    (error: unknown) => {
      if (error instanceof PublicApiError && error.status === 404) notFound();
      throw error;
    },
  );
  const me = await careersMe(school);
  const applied = me?.applications.find((a) => a.vacancyId === v.id);
  const channels = me ? null : await careersFetch<CareerSignIn>(`/${school}/sign-in`, {}, null);
  const facts: Array<[string, string | null]> = [
    ['Department', v.department],
    ['Subject', v.subject],
    ['Designation', v.designation],
    ['Employee type', v.employeeType],
    ['Campus', v.campus],
    ['Number of posts', String(v.posts)],
    ['Qualifications', v.qualification],
    ['Experience', v.experience],
    ['Pay', v.payBand],
    ['Last date to apply', istText(v.closesAt)],
  ];
  return (
    <>
      <PageHeader
        kicker={`Careers · ${v.code}`}
        title={v.title}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/careers`}>
            All posts
          </a>
        }
      />
      <Card title="The post">
        <dl className="ep-hero__facts">
          {facts
            .filter(([, val]) => val)
            .map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
        </dl>
        {v.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{v.description}</p> : null}
      </Card>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        {!me ? (
          <Card title="Sign in to apply">
            <CandidateSignIn
              school={school}
              returnTo={`/${school}/careers/form?apply=${v.id}`}
              channels={channels!}
            />
          </Card>
        ) : applied ? (
          <Card title="You have applied">
            <p style={{ marginTop: 0 }}>
              Application <strong>{applied.number}</strong>, sent on {dmy(applied.submittedAt)}. The
              school will contact you if you are shortlisted.
            </p>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/${school}/careers/mine`}>
              My applications
            </a>
          </Card>
        ) : (
          <Card title="Apply">
            <p style={{ marginTop: 0 }}>
              Your application is filled once and used for every post you apply to.{' '}
              {me.missing.length
                ? `Still needed: ${me.missing.join(', ')}.`
                : 'It is complete; check it and apply.'}
            </p>
            <a className="ep-btn ep-btn--primary" href={`/${school}/careers/form?apply=${v.id}`}>
              {me.missing.length ? 'Fill your application' : 'Check and apply'}
            </a>
          </Card>
        )}
      </div>
    </>
  );
}
