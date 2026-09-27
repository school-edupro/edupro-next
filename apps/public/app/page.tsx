import { Card, PageHeader } from '@edupro/ui';
import { langOf, publicFetch, t } from '@/lib/api';

interface School {
  code: string;
  name: string;
  shortName: string | null;
  openCycles: number;
}

/** Landing: every school with an open admission cycle (S8-05). */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = langOf((await searchParams).lang);
  const schools = await publicFetch<{ data: School[] }>('/schools', {}, null).then((r) => r.data);
  const open = schools.filter((s) => s.openCycles > 0);
  return (
    <>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Online admissions', 'ऑनलाइन प्रवेश')}
        description={t(
          lang,
          'Choose your school to see the open admission cycles.',
          'खुले प्रवेश चक्र देखने के लिए अपना विद्यालय चुनें।',
        )}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/?lang=${lang === 'hi' ? 'en' : 'hi'}`}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        {open.length === 0 ? (
          <Card>
            {t(
              lang,
              'No school is accepting applications right now.',
              'अभी कोई विद्यालय आवेदन स्वीकार नहीं कर रहा है।',
            )}
          </Card>
        ) : null}
        {open.map((s) => (
          <a
            key={s.code}
            href={`/${s.code.toLowerCase()}?lang=${lang}`}
            style={{ textDecoration: 'none' }}
          >
            <Card elevated>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  color: 'var(--text-heading)',
                }}
              >
                {s.name}
              </div>
              <div className="ep-field__help">
                {s.openCycles} {t(lang, 'open cycle(s)', 'खुले चक्र')}
              </div>
            </Card>
          </a>
        ))}
      </div>
    </>
  );
}
