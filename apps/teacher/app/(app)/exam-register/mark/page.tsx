import { Badge, Breadcrumbs, Card, PageHeader, type RegisterRow } from '@edupro/ui';
import { RegisterTabs } from '@/components/RegisterTabs';
import { apiFetch, getMe } from '@/lib/api';
import { currentLang, t } from '@/lib/i18n';

/**
 * The mark registers the person may run (docs/design/97): those given to them, and every register of a class they
 * teach (docs/design/96 part 19). Run opens the register for their sections; building and changing a register stay
 * in the admin app.
 */
export default async function MarkRegistersPage() {
  const [me, lang, list] = await Promise.all([
    getMe(),
    currentLang(),
    apiFetch<{ data: RegisterRow[] }>('/exams/schemes')
      .then((r) => r.data.filter((x) => x.rights.run))
      .catch(() => [] as RegisterRow[]),
  ]);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <Breadcrumbs
        items={[
          { label: t(lang, 'Exam register'), href: '/exam-register' },
          { label: t(lang, 'Mark Register') },
        ]}
      />
      <PageHeader
        kicker={t(lang, 'Registers')}
        title={t(lang, 'Mark registers')}
        description={t(
          lang,
          'The mark registers of the classes you teach: run one for your sections — the sheet, the reports, PDF and Excel. The office builds and changes them.',
        )}
      />
      <RegisterTabs current="mark" permissions={me.permissions} lang={lang} />
      {list.length === 0 ? (
        <Card>{t(lang, 'No mark register of your classes yet.')}</Card>
      ) : (
        <ul className="ep-reglist">
          {list.map((r) => (
            <li key={r.id} className="ep-card ep-reglist__item">
              <div className="ep-reglist__head">
                <a className="ep-reglist__name" href={`/exam-register/mark/${r.id}`}>
                  {r.name}
                </a>
                <Badge tone={r.status === 'locked' ? 'success' : 'neutral'}>
                  {t(lang, r.status === 'locked' ? 'Locked' : 'Draft')}
                </Badge>
                {r.purpose === 'result' ? <Badge tone="info">{t(lang, 'Result')}</Badge> : null}
              </div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {[
                  r.classes.map((k) => k.code).join(', '),
                  r.exams.map((e) => e.code ?? e.key).join(' · '),
                  `${String(r.subjects)} ${t(lang, 'subjects')}`,
                ]
                  .filter(Boolean)
                  .join(' — ')}
              </p>
              <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/exam-register/mark/${r.id}`}>
                ▶ {t(lang, 'Run')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
