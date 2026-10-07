import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Teacher {
  employeeId: string;
  name: string;
  designation: string | null;
  role: 'class_teacher' | 'co_class_teacher' | 'subject_teacher';
  subjects: string[];
  mobile: string | null;
  email: string | null;
  hasPhoto: boolean;
}
interface Data {
  contact: { mobile: 'full' | 'masked' | 'hidden'; email: 'full' | 'masked' | 'hidden' };
  students: Array<{ id: string; name: string; section: string | null; teachers: Teacher[] }>;
}

const ROLE: Record<Teacher['role'], string> = {
  class_teacher: 'Class teacher',
  co_class_teacher: 'Co-class teacher',
  subject_teacher: 'Subject teacher',
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Who teaches the child: the class teacher first, then the subject teachers, with the contact the school shows. */
export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: Data | null = null;
  try {
    data = await bff.api.fetch<Data>('/academics/my-teachers');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const kids = data?.students ?? [];
  const chosen = await chosenChild(sp.child);
  const child = kids.find((k) => k.id === chosen?.id) ?? kids[0];
  const masked = data?.contact.mobile === 'masked' || data?.contact.email === 'masked';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'My teachers')}
        title={
          child
            ? `${child.name}${child.section ? ` · ${child.section}` : ''}`
            : t(lang, 'My teachers')
        }
        description={t(lang, 'The class teacher and the teacher of each subject.')}
      />
      <ChildSwitch lang={lang} back="/teachers" current={child?.id} />
      {!child ? (
        <Card>
          {t(
            lang,
            'Your account is not linked to a student yet. Please contact the school office.',
          )}
        </Card>
      ) : child.teachers.length === 0 ? (
        <Card>{t(lang, 'The school has not assigned teachers to this class yet.')}</Card>
      ) : (
        <>
          <ul className="ep-tcards">
            {child.teachers.map((tch) => (
              <li key={tch.employeeId} className="ep-tcard" data-role={tch.role}>
                {tch.hasPhoto ? (
                  <img
                    className="ep-tcard__photo"
                    src={`/api/teacher-photo/${tch.employeeId}`}
                    alt=""
                    width={72}
                    height={72}
                  />
                ) : (
                  <span className="ep-tcard__photo ep-tcard__photo--none" aria-hidden="true">
                    {initials(tch.name)}
                  </span>
                )}
                <div className="ep-tcard__body">
                  <h2 className="ep-tcard__name">{tch.name}</h2>
                  <div>
                    <Badge tone={tch.role === 'subject_teacher' ? 'neutral' : 'info'}>
                      {t(lang, ROLE[tch.role])}
                    </Badge>
                  </div>
                  {tch.subjects.length ? (
                    <div className="ep-tcard__line">
                      <span>{t(lang, 'Subject')}:</span> {tch.subjects.join(', ')}
                    </div>
                  ) : null}
                  {tch.designation ? <div className="ep-tcard__line">{tch.designation}</div> : null}
                  {tch.mobile ? (
                    <div className="ep-tcard__line">
                      <span>{t(lang, 'Mobile')}:</span>{' '}
                      {data?.contact.mobile === 'full' ? (
                        <a href={`tel:${tch.mobile.replace(/[^0-9+]/g, '')}`}>{tch.mobile}</a>
                      ) : (
                        tch.mobile
                      )}
                    </div>
                  ) : null}
                  {tch.email ? (
                    <div className="ep-tcard__line">
                      <span>{t(lang, 'E-mail')}:</span>{' '}
                      {data?.contact.email === 'full' ? (
                        <a href={`mailto:${tch.email}`}>{tch.email}</a>
                      ) : (
                        tch.email
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {masked ? (
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {t(
                lang,
                'The school shows part of the number and e-mail only. To reach a teacher, raise a query or book an appointment from the Help desk.',
              )}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
