import { Button, Card } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { t, type Lang } from '@/lib/i18n';
import { downloadProfilePdf } from '@/app/(app)/profile/actions';
import type { PortalProfile } from '@/app/(app)/profile/types';

export interface FamilyChild {
  id: string;
  name: string;
  section: string | null;
}

/** Home-page summary of the chosen child: photo, class, roll, admission no and links. */
export async function ChildProfileCard({
  kids,
  child,
  lang,
}: {
  kids: FamilyChild[];
  child: FamilyChild;
  lang: Lang;
}) {
  let p: PortalProfile;
  try {
    p = await bff.api.fetch<PortalProfile>(`/engagement/mine/profile/${child.id}`);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
  return (
    <section aria-label={t(lang, 'Student profile')}>
      {kids.length > 1 ? (
        <nav
          className="pp-kids"
          aria-label={t(lang, 'Choose a child')}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {kids.map((c) => (
            <a
              key={c.id}
              href={`/?child=${c.id}`}
              aria-current={c.id === child.id ? 'page' : undefined}
            >
              {c.name}
              {c.section ? <span> · {c.section}</span> : null}
            </a>
          ))}
        </nav>
      ) : null}
      <Card elevated>
        <div className="pp-hero">
          {p.photos.student ? (
            <img
              className="pp-photo"
              src={`/api/photo/${child.id}/student${p.photoVersions?.student ? `?v=${p.photoVersions.student}` : ''}`}
              alt={p.name}
            />
          ) : (
            <span
              className="pp-photo pp-photo--empty"
              role="img"
              aria-label={`${p.name}: ${t(lang, 'no photo')}`}
            >
              {p.name.slice(0, 1)}
            </span>
          )}
          <div className="pp-hero__body">
            <h2 className="pp-hero__name">{p.name}</h2>
            <dl className="pp-facts">
              {p.enrolment ? (
                <div>
                  <dt>{t(lang, 'Class')}</dt>
                  <dd>
                    {p.enrolment.className} {p.enrolment.section}
                    {p.enrolment.rollNo ? ` · ${t(lang, 'Roll no')} ${p.enrolment.rollNo}` : ''}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{t(lang, 'Admission no')}</dt>
                <dd>{p.admissionNo}</dd>
              </div>
              {p.classTeacher ? (
                <div>
                  <dt>{t(lang, 'Class teacher')}</dt>
                  <dd>{p.classTeacher}</dd>
                </div>
              ) : null}
              {p.enrolment ? (
                <div>
                  <dt>{t(lang, 'Session')}</dt>
                  <dd>{p.enrolment.academicYear}</dd>
                </div>
              ) : null}
            </dl>
            <div className="pp-hero__actions">
              <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/profile?child=${child.id}`}>
                {t(lang, 'View full profile')}
              </a>
              <form action={downloadProfilePdf}>
                <input type="hidden" name="child" value={child.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {t(lang, 'Download profile (PDF)')}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
