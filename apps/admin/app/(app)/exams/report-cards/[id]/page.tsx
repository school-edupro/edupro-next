import { Badge, Breadcrumbs, Button, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { CardsTable } from '@/components/exams/rc/CardsTable';
import { DownloadLog } from '@/components/exams/rc/DownloadLog';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveReleaseSetup, setClassPublish, setReleaseStatus } from '@/lib/report-card-actions';
import {
  KIND_TONE,
  RELEASE_TONE,
  STEP_OF,
  STEPS,
  cardLines,
  issuesOf,
  type ReleaseReadiness,
} from '@/lib/report-card-release';
import type { Exam } from '@/lib/types';

const TABS = ['setup', 'ready', 'cards', 'publish'] as const;
type Tab = (typeof TABS)[number];

/**
 * A report-card release's workspace (docs/design/65): Set-up (its name, exams, the design of each class,
 * the fee-due rule) · Readiness (what each class still needs, with where to fix it) · Cards (the legacy
 * Exam Report Card: a line per card design, a section or class, a roll-order range or one admission
 * number, Generate and the eye; the Download Log) · Publish (to the principal, then class by class to the
 * families; revoke a class with a reason).
 */
export default async function ReleasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
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
  const sum = (k: 'students' | 'made' | 'withheld' | 'held') =>
    allSections.reduce((a, s) => a + s[k], 0);
  const students = sum('students');
  const notReady = ready.classes.filter((k) => {
    const x = issuesOf(k, rel.kind);
    return x.unverified || x.remarks || x.attendance || x.noTemplate || x.noTermResult;
  });
  const notReadyList = notReady.map((k) => k.code).join(', ');
  const published = ready.classes.filter((k) => k.publish?.status === 'released');
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
        actions={
          <span className="ep-mr-pills">
            <Badge tone={KIND_TONE[rel.kind]}>{t(`kind_${rel.kind}`)}</Badge>
            <Badge tone={RELEASE_TONE[rel.status]}>{t(`status_${rel.status}`)}</Badge>
          </span>
        }
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
        <KpiTile
          label={t('kPublished')}
          value={`${String(published.length)} / ${String(ready.classes.length)}`}
        />
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
              : t(rel.kind === 'exam' ? 'readyAllExam' : 'readyAll')}
          </p>
          {ready.classes.map((k) => {
            const x = issuesOf(k, rel.kind);
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
                {rel.kind === 'exam' ? null : (
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
                )}
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
        <section aria-label={t('cardsTitle')}>
          <div className="ep-rcw-toolbar">
            <h2>{t('cardsTitle')}</h2>
            <span style={{ flex: 1 }} />
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/help/exams#results-and-report-cards"
            >
              {t('userGuide')}
            </a>
            <DownloadLog releaseId={rel.id} />
            {canManage ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={here('setup')}>
                {t('settings')}
              </a>
            ) : null}
          </div>
          <CardsTable
            releaseId={rel.id}
            term={{ code: rel.termCode, name: rel.name }}
            canManage={canManage}
            lines={cardLines(ready.classes).map((x) => ({
              key: x.key,
              label: x.label,
              design: x.design,
              classes: x.classes.map((k) => ({
                id: k.classId,
                code: k.code,
                sections: k.sections.map((c) => ({ id: c.id, code: c.code })),
              })),
            }))}
          />
          <p className="ep-field__help">{t('cardsHelp')}</p>
        </section>
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
                  ? t('st_released_classes', {
                      n: published.length,
                      total: ready.classes.length,
                      told: rel.notifiedCount ?? 0,
                    })
                  : t('st_withdrawn', {
                      hasReason: rel.withdrawnReason ? 'yes' : 'no',
                      reason: rel.withdrawnReason ?? '',
                    })}
          </p>
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
            {canPublish && published.length < ready.classes.length ? (
              <ConfirmAction
                action={setReleaseStatus}
                fields={{ id: rel.id, back: here('publish'), status: 'released' }}
                label={t('publishAll')}
                title={t('publishAllTitle')}
                confirmLabel={t('publishConfirm')}
                variant="secondary"
              >
                {t('publishAllBody', {
                  list: ready.classes
                    .filter((k) => k.publish?.status !== 'released')
                    .map((k) => k.code)
                    .join(', '),
                })}
                {notReady.length
                  ? ` ${t('publishNotReady', { n: notReady.length, list: notReadyList })}`
                  : ''}
              </ConfirmAction>
            ) : null}
            {canPublish && published.length ? (
              <ConfirmAction
                action={setReleaseStatus}
                fields={{ id: rel.id, back: here('publish'), status: 'withdrawn' }}
                label={t('revokeAll')}
                title={t('revokeAllTitle')}
                confirmLabel={t('revokeAll')}
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: t('withdrawReason'), placeholder: t('withdrawPlaceholder') }}
              >
                {t('revokeAllBody', { list: published.map((k) => k.code).join(', ') })}
              </ConfirmAction>
            ) : null}
          </div>
          <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-4)' }}>
            <table className="ep-table">
              <caption className="ep-sr-only">{t('classPublishCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('class')}</th>
                  <th scope="col">{t('kStudents')}</th>
                  <th scope="col">{t('readyCol')}</th>
                  <th scope="col">{t('publishCol')}</th>
                  <th scope="col">
                    <span className="ep-sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ready.classes.map((k) => {
                  const x = issuesOf(k, rel.kind);
                  const gaps = [
                    x.noTemplate ? t('gapDesign') : null,
                    x.noTermResult ? t('gapTerm') : null,
                    x.unverified ? t('gapPapers', { n: x.unverified }) : null,
                    x.remarks ? t('gapRemarks', { n: x.remarks }) : null,
                    x.attendance ? t('gapAttendance', { n: x.attendance }) : null,
                  ].filter(Boolean) as string[];
                  const p = k.publish;
                  const n = k.sections.reduce((a, c) => a + c.students, 0);
                  return (
                    <tr key={k.classId}>
                      <td>
                        <strong>{k.code}</strong>
                        <span className="ep-mr-col__desc">
                          {t('sectionsOf', { list: k.sections.map((c) => c.code).join(', ') })}
                        </span>
                      </td>
                      <td>{n}</td>
                      <td>
                        {gaps.length ? (
                          <>
                            <Badge tone="warning">{t('notReadyBadge')}</Badge>
                            <span className="ep-mr-col__desc">
                              {gaps.join(' · ')} — <a href={here('ready')}>{t('seeReadiness')}</a>
                            </span>
                          </>
                        ) : (
                          <Badge tone="success">{t('readyBadge')}</Badge>
                        )}
                      </td>
                      <td>
                        {p?.status === 'released' ? (
                          <>
                            <Badge tone="success">{t('status_released')}</Badge>
                            <span className="ep-mr-col__desc">
                              {t('classPublishedOn', { date: when(p.releasedAt), n: p.notified })}
                            </span>
                          </>
                        ) : p?.status === 'withdrawn' ? (
                          <>
                            <Badge tone="danger">{t('status_withdrawn')}</Badge>
                            <span className="ep-mr-col__desc">
                              {t('classRevokedOn', {
                                date: when(p.withdrawnAt),
                                reason: p.reason ?? '',
                              })}
                            </span>
                          </>
                        ) : (
                          <Badge tone="neutral">{t('notPublished')}</Badge>
                        )}
                      </td>
                      <td>
                        {canPublish && p?.status !== 'released' ? (
                          <ConfirmAction
                            action={setClassPublish}
                            fields={{
                              id: rel.id,
                              back: here('publish'),
                              classId: k.classId,
                              status: 'released',
                              label: k.code,
                            }}
                            label={t('publishClass', { cls: k.code })}
                            title={t('publishClassTitle', { cls: k.code })}
                            confirmLabel={t('publishConfirm')}
                            variant="primary"
                          >
                            {t('publishClassBody', { n, cls: k.code })}
                            {gaps.length
                              ? ` ${t('publishClassGaps', { list: gaps.join(', ') })}`
                              : ''}
                          </ConfirmAction>
                        ) : null}
                        {canPublish && p?.status === 'released' ? (
                          <ConfirmAction
                            action={setClassPublish}
                            fields={{
                              id: rel.id,
                              back: here('publish'),
                              classId: k.classId,
                              status: 'withdrawn',
                              label: k.code,
                            }}
                            label={t('revokeClass', { cls: k.code })}
                            title={t('revokeClassTitle', { cls: k.code })}
                            confirmLabel={t('revoke')}
                            variant="ghost"
                            confirmVariant="danger"
                            reason={{
                              label: t('withdrawReason'),
                              placeholder: t('withdrawPlaceholder'),
                            }}
                          >
                            {t('revokeClassBody', { cls: k.code })}
                          </ConfirmAction>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!canPublish ? <p className="ep-field__help">{t('publishWho')}</p> : null}
        </Card>
      ) : null}
    </>
  );
}
