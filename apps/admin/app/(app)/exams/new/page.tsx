import { Breadcrumbs, Button, Card, FormActions, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { Notice } from '@/components/Notice';
import { TickAll } from '@/components/TickAll';
import { apiFetch, getMe } from '@/lib/api';
import { createExamGuided } from '@/lib/exam-hub-actions';
import type { ClassRow, Exam, ExamType, GradeScale, Page } from '@/lib/types';

/**
 * A new exam, step 1 of 3 (docs/design/66): blank, or a copy of an earlier exam of the session (its
 * classes, subjects, parts and sets come with it). Step 2 is each class's subjects, step 3 the date
 * sheet, both on the exam's Set-up.
 */
export default async function NewExamPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, l, me, exams, types, scales, classes] = await Promise.all([
    getTranslations('examHub.new'),
    getTranslations('examHub.list'),
    getMe(),
    apiFetch<{ data: Exam[] }>('/exams').then((r) => r.data),
    apiFetch<{ data: ExamType[] }>('/exams/types').then((r) =>
      r.data.filter((x) => x.status === 'active'),
    ),
    apiFetch<{ data: GradeScale[] }>('/exams/grade-scales').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
  ]);
  if (!me.permissions.includes('exams.master.manage')) notFound();
  const from = exams.find((e) => e.id === sp.from) ?? null;
  const steps = [t('stepDetails'), t('stepSubjects'), t('stepDates')];
  return (
    <>
      <Breadcrumbs items={[{ label: l('title'), href: '/exams' }, { label: t('title') }]} />
      <PageHeader kicker={t('step', { n: 1 })} title={t('title')} description={t('description')} />
      <ol className="ep-xstages" aria-label={t('title')} style={{ marginBottom: 'var(--sp-4)' }}>
        {steps.map((x, i) => (
          <li key={x} aria-current={i === 0 ? 'step' : undefined}>
            {x}
          </li>
        ))}
      </ol>
      <Notice params={sp} />
      {types.length === 0 ? (
        <Card>
          <p>{t('noTypes')}</p>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/exams/masters">
            {l('open')}
          </a>
        </Card>
      ) : (
        <Card>
          {exams.length ? (
            <form method="get" style={{ marginBottom: 'var(--sp-4)' }}>
              <AutoSubmit />
              <label className="ep-field" htmlFor="from">
                <span className="ep-field__label">{t('startFrom')}</span>
                <select id="from" name="from" className="ep-select" defaultValue={from?.id ?? ''}>
                  <option value="">{t('blank')}</option>
                  {exams.map((e) => (
                    <option key={e.id} value={e.id}>
                      {t('copyOf', { name: `${e.name} (${e.code})` })}
                    </option>
                  ))}
                </select>
              </label>
              {from ? (
                <p className="ep-field__help">
                  {t('copyHelp', { name: from.name })}{' '}
                  {from.classes.map((k) => k.classCode).join(', ')}
                </p>
              ) : null}
              <noscript>
                <button type="submit" className="ep-btn ep-btn--secondary">
                  {l('show')}
                </button>
              </noscript>
            </form>
          ) : null}
          <form action={createExamGuided} key={from?.id ?? 'blank'}>
            {from ? <input type="hidden" name="fromId" value={from.id} /> : null}
            <div className="ep-rp__row">
              <label className="ep-field" htmlFor="examTypeId">
                <span className="ep-field__label">{t('type')}</span>
                <select
                  id="examTypeId"
                  name="examTypeId"
                  className="ep-select"
                  required
                  defaultValue={from?.examTypeId ?? types[0]?.id}
                >
                  {types.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="name">
                <span className="ep-field__label">{t('name')}</span>
                <input
                  id="name"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder={t('namePlaceholder')}
                />
              </label>
              <label className="ep-field" htmlFor="code">
                <span className="ep-field__label">{t('code')}</span>
                <input
                  id="code"
                  name="code"
                  className="ep-input"
                  pattern="[A-Za-z0-9_\-]{2,20}"
                  aria-describedby="code-help"
                />
                <span id="code-help" className="ep-field__help">
                  {t('codeHelp')}
                </span>
              </label>
            </div>
            <div className="ep-rp__row">
              <label className="ep-field" htmlFor="startsOn">
                <span className="ep-field__label">{t('from')}</span>
                <input id="startsOn" name="startsOn" className="ep-input" type="date" />
              </label>
              <label className="ep-field" htmlFor="endsOn">
                <span className="ep-field__label">{t('to')}</span>
                <input id="endsOn" name="endsOn" className="ep-input" type="date" />
              </label>
              <label className="ep-check" htmlFor="showOnPortal" style={{ alignSelf: 'center' }}>
                <input
                  id="showOnPortal"
                  name="showOnPortal"
                  className="ep-check__input"
                  type="checkbox"
                  defaultChecked={from?.showOnPortal ?? false}
                />
                <span className="ep-check__box" aria-hidden="true" /> {t('portal')}
              </label>
            </div>
            {from ? null : (
              <>
                <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="ep-field__label">{t('classes')}</legend>
                  <TickAll name="classId" label={t('tickAll')} />
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--sp-2) var(--sp-4)',
                      marginTop: 'var(--sp-2)',
                    }}
                  >
                    {classes.map((k) => (
                      <label key={k.id} className="ep-check" htmlFor={`nc-${k.id}`}>
                        <input
                          id={`nc-${k.id}`}
                          className="ep-check__input"
                          type="checkbox"
                          name="classId"
                          value={k.id}
                        />
                        <span className="ep-check__box" aria-hidden="true" /> {k.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="ep-field" htmlFor="gradeScaleId" style={{ maxWidth: '24rem' }}>
                  <span className="ep-field__label">{t('gradeScale')}</span>
                  <select id="gradeScaleId" name="gradeScaleId" className="ep-select">
                    <option value="">{t('noScale')}</option>
                    {scales.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.code})
                      </option>
                    ))}
                  </select>
                  <span className="ep-field__help">{t('gradeScaleHelp')}</span>
                </label>
              </>
            )}
            <FormActions>
              <Button type="submit">{from ? t('createCopy') : t('create')}</Button>
              <a className="ep-btn ep-btn--ghost" href="/exams">
                {t('cancel')}
              </a>
            </FormActions>
          </form>
        </Card>
      )}
    </>
  );
}
