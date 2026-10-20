import { Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import { CAREERS_COOKIE, careersFetch, istText, type CareerVacancy } from '@/lib/careers';

/** The school's open vacancies (docs/design/34-recruitment.md, part 2). */
export default async function CareersPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  const list = await careersFetch<{ school: string; data: CareerVacancy[] }>(
    `/${school}`,
    {},
    null,
  ).catch((error: unknown) => {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  });
  const signedIn = Boolean((await cookies()).get(CAREERS_COOKIE)?.value);
  return (
    <>
      <PageHeader
        kicker={list.school || school.toUpperCase()}
        title="Careers"
        description="Posts open now. Sign in with a code to your mobile or email, fill your application once, and apply to any of them."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/${school}/careers/mine`}>
              {signedIn ? 'My applications' : 'Sign in'}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}`}>
              Admissions
            </a>
          </span>
        }
      />
      {list.data.length === 0 ? (
        <Card>No post is open just now. Please look again later.</Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          {list.data.map((v) => (
            <article key={v.id} className="ep-card" style={{ padding: 'var(--sp-4)' }}>
              <h2 className="ep-card__title" style={{ marginTop: 0 }}>
                <a href={`/${school}/careers/${v.id}`}>{v.title}</a>
              </h2>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {[v.department, v.subject, v.employeeType, v.campus].filter(Boolean).join(' · ')}
                {v.posts > 1 ? ` · ${String(v.posts)} posts` : ''}
              </p>
              {v.qualification ? (
                <p style={{ margin: 0 }}>Qualifications: {v.qualification}</p>
              ) : null}
              <p className="ep-field__help">Last date to apply: {istText(v.closesAt)}</p>
              <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/${school}/careers/${v.id}`}>
                View and apply
              </a>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
