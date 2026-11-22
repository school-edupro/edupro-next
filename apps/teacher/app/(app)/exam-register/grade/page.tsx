import { Badge, Breadcrumbs, Card, PageHeader, type GradeRegisterRow } from '@edupro/ui';
import { RegisterTabs } from '@/components/RegisterTabs';
import { apiFetch, getMe } from '@/lib/api';
import { currentLang, t } from '@/lib/i18n';

/**
 * The grade registers the person may run (docs/design/97): those given to them, and every register of a class they
 * teach (docs/design/96 part 19). Run opens the register for their sections.
 */
export default async function GradeRegistersPage() {
  const [me, lang, list] = await Promise.all([
    getMe(),
    currentLang(),
    apiFetch<{ data: GradeRegisterRow[] }>('/exams/grade-registers')
      .then((r) => r.data.filter((x) => x.rights.run))
      .catch(() => [] as GradeRegisterRow[]),
  ]);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <Breadcrumbs
        items={[
          { label: t(lang, 'Exam register'), href: '/exam-register' },
          { label: t(lang, 'Grade Register') },
        ]}
      />
      <PageHeader
        kicker={t(lang, 'Registers')}
        title={t(lang, 'Grade registers')}
        description={t(
          lang,
          'The grade registers of the classes you teach: run one for your sections — the class sheet or student-wise, the grade summary and analysis, PDF and Excel.',
        )}
      />
      <RegisterTabs current="grade" permissions={me.permissions} lang={lang} />
      {list.length === 0 ? (
        <Card>{t(lang, 'No grade register of your classes yet.')}</Card>
      ) : (
        <ul className="ep-reglist">
          {list.map((r) => (
            <li key={r.id} className="ep-card ep-reglist__item">
              <div className="ep-reglist__head">
                <a className="ep-reglist__name" href={`/exam-register/grade/${r.id}`}>
                  {r.name}
                </a>
                <Badge tone={r.status === 'locked' ? 'success' : 'neutral'}>
                  {t(lang, r.status === 'locked' ? 'Locked' : 'Draft')}
                </Badge>
              </div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {[r.classes.map((k) => k.code).join(', '), r.assessments.join(' · ')]
                  .filter(Boolean)
                  .join(' — ')}
              </p>
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/exam-register/grade/${r.id}`}
              >
                ▶ {t(lang, 'Run')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
