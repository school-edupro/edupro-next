import { Badge, Breadcrumbs, Button, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { CardPreview } from '@/components/exams/rc/CardPreview';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  holdCard,
  renderCard,
  renderSections,
  saveReleaseSetup,
  setReleaseStatus,
} from '@/lib/report-card-actions';
import {
  RELEASE_TONE,
  STEP_OF,
  STEPS,
  issuesOf,
  type ReleaseReadiness,
} from '@/lib/report-card-release';
import type { Exam, ReportCardStatus } from '@/lib/types';

const TABS = ['setup', 'ready', 'cards', 'publish'] as const;
type Tab = (typeof TABS)[number];

/**
 * A report-card release's workspace (docs/design/65): Set-up (its name, exams, the design of each class,
 * the fee-due rule) · Readiness (what each class still needs, with where to fix it) · Cards (each class's
 * sections as tiles; a section's students with the preview, holds and their PDFs) · Publish (to the
 * principal, then to the families; withdraw with a reason).
 */
export default async function ReleasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    section?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const [me, ready, exams, tp, t, locale] = await Promise.all([
    getMe(),
    apiFetch<ReleaseReadiness>(`/exams/report-cards/releases/${id}/readiness`).catch(
      (e: unknown) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
        throw e;
      },
    ),
    apiFetch<{ data: Exam[] }>('/exams').then((x) => x.data),
    getTranslations('pages.exams_report_cards'),
    getTranslations('rcRelease'),
    getLocale(),
  ]);
  const when = (iso: string | null | undefined) =>
    iso
      ? new Intl.DateTimeFormat(`${locale}-IN`, {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(iso))
      : '';
  const rel = ready.release;
  const canManage = me.permissions.includes('exams.report_card.manage');
  const canPublish = me.permissions.includes('exams.result.publish');
  const tab: Tab = TABS.find((k) => k === sp.tab) ?? (rel.status === 'draft' ? 'ready' : 'cards');
  const here = (to: Tab, extra = '') => `/exams/report-cards/${rel.id}?tab=${to}${extra}`;
  const allSections = ready.classes.flatMap((k) => k.sections);
  const section = allSections.find((s) => s.id === sp.section) ?? null;
  const cards =
    tab === 'cards' && section
      ? await apiFetch<{ data: ReportCardStatus[] }>(
          `/exams/report-cards/releases/${rel.id}/cards?classSectionId=${section.id}`,
        ).then((x) => x.data)
      : [];
  const sum = (k: 'students' | 'made' | 'withheld' | 'held') =>
    allSections.reduce((a, s) => a + s[k], 0);
  const students = sum('students');
  const notReady = ready.classes.filter((k) => {
    const x = issuesOf(k);
    return x.unverified || x.remarks || x.attendance || x.noTemplate || x.noTermResult;
  });
  const notReadyList = notReady.map((k) => k.code).join(', ');
  const at = STEP_OF[rel.status];
  const link = (href: string) => (chunks: ReactNode) => <a href={href}>{chunks}</a>;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('exams'), href: '/exams' },
          { label: tp('title'), href: '/exams/report-cards' },
          { label: `${rel.termCode} · ${rel.name}` },
        ]}
      />
      <PageHeader
        kicker={t('kicker', { term: rel.termCode })}
        title={rel.name}
        description={t('carries', {
          exams: rel.exams.map((e) => e.code).join(', '),
          classes: ready.classes.map((k) => k.code).join(', '),
        })}
        actions={<Badge tone={RELEASE_TONE[rel.status]}>{t(`status_${rel.status}`)}</Badge>}
      />
      <ol
        className="ep-xstages"
        aria-label={t('whereItStands')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {STEPS.map((k, i) => (
          <li
            key={k}
            data-state={i < at || (i === at && rel.status === 'released') ? 'done' : undefined}
            aria-current={i === at && rel.status !== 'released' ? 'step' : undefined}
          >
            {t(k)}
          </li>
        ))}
      </ol>
      <Notice params={sp} />
      <div className="ep-rcw-kpis">
        <KpiTile label={t('kClasses')} value={String(ready.classes.length)} />
        <KpiTile label={t('kStudents')} value={String(students)} />
        <KpiTile label={t('kPdfs')} value={`${String(sum('made'))} / ${String(students)}`} />
        <KpiTile label={t('kWithheld')} value={String(sum('withheld'))} />
        <KpiTile label={t('kHeld')} value={String(sum('held'))} />
        <KpiTile label={t('kNotReady')} value={String(notReady.length)} />
      </div>
      <nav aria-label={t('stepsNav')} style={{ marginBottom: 'var(--sp-4)' }}>
        <ul className="ep-xchips">
          {TABS.map((k) => (
            <li key={k} style={{ padding: 0, border: 0, background: 'none' }}>
              <a href={here(k)} aria-current={tab === k ? 'page' : undefined}>
                {t(`tab_${k}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'setup' ? (
        <Card elevated title={t('tab_setup')}>
          <form action={saveReleaseSetup} className="ep-rcw-setup">
            <input type="hidden" name="id" value={rel.id} />
            <input type="hidden" name="back" value={here('setup')} />
            {rel.status === 'released' ? (
              <p className="ep-alert ep-alert--info" style={{ margin: 0 }}>
                {t('publishedNote')}
              </p>
            ) : null}
            <label className="ep-field">
              <span className="ep-field__label">{t('name')}</span>
              <input
                className="ep-input"
                name="name"
                defaultValue={rel.name}
                required
                minLength={2}
                maxLength={120}
                disabled={!canManage}
              />
            </label>
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">{t('examsCarry')}</legend>
              <div className="ep-mr-tiles">
                {exams.map((e) => (
                  <label key={e.id} className="ep-mr-tile">
                    <input
                      type="checkbox"
                      name="examIds"
                      value={e.id}
                      defaultChecked={rel.examIds.includes(e.id)}
                      disabled={!canManage}
                    />
                    <span>
                      {e.code}
                      <small>{e.name}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">{t('classCard')}</legend>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {t('classCardHelp')}
              </p>
              {Object.entries(rel.templates)
                .filter(([k]) => !k.startsWith('class_'))
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={`tpl:${k}`} value={v} />
                ))}
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{t('classCard')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('class')}</th>
                      <th scope="col">{t('band')}</th>
                      <th scope="col">{t('design')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ready.classes.map((k) => (
                      <tr key={k.classId}>
                        <td>
                          <strong>{k.code}</strong>
                        </td>
                        <td>{t(`band_${k.band}` as 'band_middle')}</td>
                        <td>
                          <select
                            className="ep-select"
                            name={`tpl:class_${k.classId}`}
                            aria-label={t('designFor', { cls: k.code })}
                            defaultValue={rel.templates[`class_${k.classId}`] ?? ''}
                            disabled={!canManage}
                          >
                            <option value="">
                              {k.template && k.template.from !== 'class'
                                ? t('bandsOwnNamed', { name: k.template.name })
                                : t('bandsOwn')}
                            </option>
                            {ready.templates.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
            <div className="ep-rcw-setup__fee">
              <label className="ep-check">
                <input
                  className="ep-check__input"
                  type="checkbox"
                  name="hideDefaulters"
                  defaultChecked={rel.hideDefaulters}
                  disabled={!canManage}
                />
                <span className="ep-check__box" aria-hidden="true" /> {t('hideDefaulters')}
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{t('feeAbove')}</span>
                <input
                  className="ep-input"
                  name="defaulterMin"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={Number(rel.defaulterMin)}
                  disabled={!canManage}
                />
              </label>
            </div>
            {canManage ? (
              <div className="ep-form-actions">
                <Button type="submit">{t('saveSetup')}</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}

      {tab === 'ready' ? (
        <>
          <p
            className={`ep-alert ep-alert--${notReady.length ? 'warning' : 'success'}`}
            style={{ marginTop: 0 }}
          >
            {notReady.length
              ? t('readySome', {
                  ready: ready.classes.length - notReady.length,
                  total: ready.classes.length,
                })
              : t('readyAll')}
          </p>
          {ready.classes.map((k) => {
            const x = issuesOf(k);
            const term = k.termResult;
            return (
              <Card
                key={k.classId}
                elevated
                title={`${k.code} · ${k.name}`}
                style={{ marginBottom: 'var(--sp-3)' }}
              >
                <p className="ep-rcw-check" data-ok={String(!x.noTemplate)}>
                  {k.template ? (
                    <span>
                      {t.rich('prints', {
                        name: k.template.name,
                        b: (c) => <strong>{c}</strong>,
                      })}{' '}
                      {t(`from_${k.template.from}`)}
                    </span>
                  ) : (
                    <span>{t.rich('noDesign', { a: link('/exams/report-cards/templates') })}</span>
                  )}
                </p>
                <p className="ep-rcw-check" data-ok={String(!x.noTermResult)}>
                  <span>
                    {term?.computedAt
                      ? t.rich('termWorked', {
                          name: term.name,
                          date: when(term.computedAt),
                          n: term.results,
                          a: link(`/exams/schemes/${term.schemeId}`),
                        })
                      : term
                        ? t.rich('termNotWorked', {
                            name: term.name,
                            a: link(`/exams/schemes/${term.schemeId}`),
                          })
                        : t.rich('noTerm', { term: rel.termCode, a: link('/exams/schemes') })}
                  </span>
                </p>
                {k.exams.map((e) => (
                  <div key={e.examId}>
                    <p className="ep-rcw-check" data-ok={String(!e.unverified)}>
                      <span>
                        {e.unverified
                          ? t.rich('unverifiedLine', {
                              code: e.code,
                              n: e.unverified,
                              total: e.papers,
                              a: link(`/exams/${e.examId}/status?classId=${k.classId}`),
                            })
                          : t('allVerified', { code: e.code, n: e.papers })}
                      </span>
                    </p>
                    {e.remarksMissing ? (
                      <p className="ep-rcw-check" data-ok="false">
                        <span>
                          {t.rich('remarksLine', {
                            code: e.code,
                            n: e.remarksMissing,
                            a: link(`/exams/${e.examId}/remarks`),
                          })}
                        </span>
                      </p>
                    ) : null}
                    {e.attendanceMissing ? (
                      <p className="ep-rcw-check" data-ok="false">
                        <span>
                          {t.rich('attendanceLine', {
                            code: e.code,
                            n: e.attendanceMissing,
                            a: link(`/exams/${e.examId}/attendance`),
                          })}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ))}
              </Card>
            );
          })}
        </>
      ) : null}

      {tab === 'cards' ? (
        <>
          {ready.classes.map((k) => (
            <section key={k.classId} className="ep-rcw-class" aria-label={k.code}>
              <div className="ep-rcw-class__head">
                <h3>{k.code}</h3>
                <span className="ep-field__help" style={{ margin: 0 }}>
                  {k.template ? k.template.name : t('noDesignShort')} ·{' '}
                  {t('pdfsOf', {
                    made: k.sections.reduce((a, s) => a + s.made, 0),
                    total: k.sections.reduce((a, s) => a + s.students, 0),
                  })}
                </span>
                <span style={{ flex: 1 }} />
                {canManage && k.sections.length ? (
                  <form action={renderSections}>
                    <input type="hidden" name="id" value={rel.id} />
                    <input
                      type="hidden"
                      name="back"
                      value={here('cards', section ? `&section=${section.id}` : '')}
                    />
                    {k.sections.map((s) => (
                      <input key={s.id} type="hidden" name="sectionId" value={s.id} />
                    ))}
                    <Button type="submit" size="sm" variant="secondary">
                      {t('makeClass', { cls: k.code, n: k.sections.length })}
                    </Button>
                  </form>
                ) : null}
              </div>
              <div className="ep-rcw-tiles">
                {k.sections.map((s) => (
                  <a
                    key={s.id}
                    className="ep-rcw-tile"
                    href={`${here('cards', `&section=${s.id}`)}#students`}
                    aria-current={section?.id === s.id ? 'true' : undefined}
                  >
                    <strong>{s.code}</strong>
                    <span>{t('pdfsOf', { made: s.made, total: s.students })}</span>
                    <span className="ep-rcw-tile__bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${String(s.students ? Math.round((s.made / s.students) * 100) : 0)}%`,
                        }}
                      />
                    </span>
                    <small>
                      {t('tileSub', { withheld: s.withheld, held: s.held })}
                      {s.unverified ? t('tileUnverified', { n: s.unverified }) : ''}
                    </small>
                  </a>
                ))}
              </div>
            </section>
          ))}
          {section ? (
            <Card
              elevated
              id="students"
              title={t('studentsOf', { sec: section.code })}
              actions={
                canManage ? (
                  <form action={renderSections}>
                    <input type="hidden" name="id" value={rel.id} />
                    <input
                      type="hidden"
                      name="back"
                      value={here('cards', `&section=${section.id}`)}
                    />
                    <input type="hidden" name="sectionId" value={section.id} />
                    <Button type="submit" size="sm">
                      {t('makeSection', { sec: section.code })}
                    </Button>
                  </form>
                ) : null
              }
            >
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {t('sectionHelp')}
              </p>
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={t('cardsOf', { sec: section.code })}
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{t('cardsOf', { sec: section.code })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('roll')}</th>
                      <th scope="col">{t('student')}</th>
                      <th scope="col">{t('card')}</th>
                      <th scope="col">{t('pdf')}</th>
                      <th scope="col">
                        <span className="ep-sr-only">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c, i) => {
                      const back = here('cards', `&section=${section.id}`);
                      return (
                        <tr key={c.studentId}>
                          <td>{c.rollNo ?? ''}</td>
                          <td>
                            <strong>{c.name}</strong>
                            <span className="ep-mr-col__desc">{c.admissionNo}</span>
                          </td>
                          <td>
                            <span className="ep-mr-pills">
                              {c.withheld ? (
                                <Badge tone="danger">
                                  {c.withheldReason ?? t('withheldBadge')}
                                </Badge>
                              ) : null}
                              {c.heldReason ? (
                                <Badge tone="warning">
                                  {t('heldBadge', { reason: c.heldReason })}
                                </Badge>
                              ) : null}
                              {!c.withheld && !c.heldReason ? (
                                <Badge tone="success">{t('shown')}</Badge>
                              ) : null}
                            </span>
                          </td>
                          <td>
                            {c.exportId && c.exportStatus === 'ready' ? (
                              <FileLinks
                                href={`/reports/exports/${c.exportId}/download`}
                                label={t('pdfLabel')}
                              />
                            ) : (
                              <span className="ep-field__help" style={{ margin: 0 }}>
                                {c.exportStatus === 'failed'
                                  ? t('pdfFailed')
                                  : c.exportStatus
                                    ? t('pdfMaking')
                                    : t('pdfNone')}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="ep-mr-row-actions">
                              <CardPreview
                                releaseId={rel.id}
                                students={cards.map((x) => ({ id: x.studentId, name: x.name }))}
                                at={i}
                              />
                              {canManage && c.heldReason ? (
                                <ConfirmAction
                                  action={holdCard}
                                  fields={{ id: rel.id, back, studentId: c.studentId, held: 'no' }}
                                  label={t('showAgain')}
                                  title={t('showAgainTitle', { name: c.name })}
                                  confirmLabel={t('showAgain')}
                                  variant="ghost"
                                >
                                  {t('showAgainBody')}
                                </ConfirmAction>
                              ) : null}
                              {canManage && !c.heldReason ? (
                                <ConfirmAction
                                  action={holdCard}
                                  fields={{ id: rel.id, back, studentId: c.studentId, held: 'yes' }}
                                  label={t('hold')}
                                  title={t('holdTitle', { name: c.name })}
                                  confirmLabel={t('holdConfirm')}
                                  variant="ghost"
                                  reason={{
                                    label: t('holdReason'),
                                    placeholder: t('holdPlaceholder'),
                                  }}
                                >
                                  {t('holdBody')}
                                </ConfirmAction>
                              ) : null}
                              {canManage ? (
                                <form action={renderCard}>
                                  <input type="hidden" name="id" value={rel.id} />
                                  <input type="hidden" name="back" value={back} />
                                  <input type="hidden" name="studentId" value={c.studentId} />
                                  <Button type="submit" size="sm" variant="ghost">
                                    {t('makePdf')}
                                  </Button>
                                </form>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <p className="ep-field__help">{t('pickSection')}</p>
          )}
        </>
      ) : null}

      {tab === 'publish' ? (
        <Card elevated title={t('tab_publish')}>
          <p style={{ marginTop: 0 }}>
            <Badge tone={RELEASE_TONE[rel.status]}>{t(`status_${rel.status}`)}</Badge>{' '}
            {rel.status === 'draft'
              ? t('st_draft')
              : rel.status === 'submitted'
                ? t('st_submitted', { date: when(rel.submittedAt) })
                : rel.status === 'released'
                  ? t('st_released', { date: when(rel.releasedAt), n: rel.notifiedCount ?? 0 })
                  : t('st_withdrawn', {
                      hasReason: rel.withdrawnReason ? 'yes' : 'no',
                      reason: rel.withdrawnReason ?? '',
                    })}
          </p>
          {notReady.length && rel.status !== 'released' ? (
            <div className="ep-alert ep-alert--warning" style={{ marginBottom: 'var(--sp-3)' }}>
              {t('notReadyWarn', { n: notReady.length, list: notReadyList })}{' '}
              <a href={here('ready')}>{t('seeReadiness')}</a>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {canManage && (rel.status === 'draft' || rel.status === 'withdrawn') ? (
              <ConfirmAction
                action={setReleaseStatus}
                fields={{ id: rel.id, back: here('publish'), status: 'submitted' }}
                label={t('send')}
                title={t('sendTitle')}
                confirmLabel={t('sendConfirm')}
                variant="secondary"
              >
                {t('sendBody')}
              </ConfirmAction>
            ) : null}
            {canPublish && rel.status !== 'released' ? (
              <ConfirmAction
                action={setReleaseStatus}
                fields={{ id: rel.id, back: here('publish'), status: 'released' }}
                label={t('publish')}
                title={t('publishTitle')}
                confirmLabel={t('publishConfirm')}
                variant="primary"
              >
                {t('publishBody', { n: students })}
                {notReady.length
                  ? ` ${t('publishNotReady', { n: notReady.length, list: notReadyList })}`
                  : ''}
              </ConfirmAction>
            ) : null}
            {canPublish && rel.status === 'released' ? (
              <ConfirmAction
                action={setReleaseStatus}
                fields={{ id: rel.id, back: here('publish'), status: 'withdrawn' }}
                label={t('withdraw')}
                title={t('withdrawTitle')}
                confirmLabel={t('withdraw')}
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: t('withdrawReason'), placeholder: t('withdrawPlaceholder') }}
              >
                {t('withdrawBody')}
              </ConfirmAction>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
