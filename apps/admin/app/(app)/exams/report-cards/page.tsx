import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { NewReleaseDialog } from '@/components/exams/rc/NewReleaseDialog';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { setClassPublish } from '@/lib/report-card-actions';
import { ScopeNote } from '@/components/exams/rc/ScopeNote';
import {
  KIND_TONE,
  RELEASE_TONE,
  STEP_OF,
  STEPS,
  type CardScope,
  type ClassCard,
} from '@/lib/report-card-release';
import type { ClassRow, Exam, Page, ReportCardRelease } from '@/lib/types';

/**
 * Report cards (docs/design/65): every card of the year — an exam card (PT1, PT2 …), a term card or an
 * annual card — with its exams, where it stands (draft, with the principal, published class by class)
 * and its PDFs; a new card in a dialog. "By class" shows one class's cards side by side (several can be
 * live at once) with Publish and Revoke for that class. A card opens its workspace: Set-up, Readiness,
 * Cards, Publish. A coordinator sees the classes they coordinate and a class teacher their own section;
 * the principal every class (the API keeps to them).
 */
export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    view?: string;
    class?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const byClass = sp.view === 'class';
  // a coordinator sees the classes they coordinate, a class teacher their section (the principal all)
  const scope = await apiFetch<CardScope>('/exams/report-cards/scope').catch((e: unknown) => {
    // the page is the principal's, the coordinators' and the class teachers'
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  });
  const asked = byClass && /^\d{1,18}$/.test(sp.class ?? '') ? sp.class! : null;
  const classId = asked && (scope.all || scope.classes.includes(asked)) ? asked : null;
  const [me, releases, exams, allClasses, cards, tp, t, locale] = await Promise.all([
    getMe(),
    apiFetch<{ data: ReportCardRelease[] }>('/exams/report-cards/releases').then((x) => x.data),
    apiFetch<{ data: Exam[] }>('/exams').then((x) => x.data),
    byClass
      ? apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((x) => x.data)
      : Promise.resolve([] as ClassRow[]),
    classId
      ? apiFetch<{ data: ClassCard[] }>(`/exams/report-cards/classes/${classId}/cards`).then(
          (x) => x.data,
        )
      : Promise.resolve([] as ClassCard[]),
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
        }).format(new Date(iso))
      : '';
  const canManage = me.permissions.includes('exams.report_card.manage');
  const canPublish = me.permissions.includes('exams.result.publish');
  const classes = scope.all ? allClasses : allClasses.filter((k) => scope.classes.includes(k.id));
  const klass = classes.find((k) => k.id === classId);
  const back = `/exams/report-cards?view=class&class=${classId ?? ''}`;
  return (
    <>
      <Breadcrumbs items={[{ label: t('exams'), href: '/exams' }, { label: tp('title') }]} />
      <PageHeader
        kicker={tp('kicker')}
        title={tp('title')}
        description={tp('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/report-cards/templates">
              {t('designs')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/report-cards/signatures">
              {t('signatures')}
            </a>
            {canManage ? (
              <NewReleaseDialog
                exams={exams.map((e) => ({ id: e.id, code: e.code, name: e.name }))}
                openAtStart={sp.new === '1'}
              />
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <ScopeNote scope={scope} />
      <nav aria-label={t('views')} style={{ marginBottom: 'var(--sp-4)' }}>
        <ul className="ep-xchips">
          <li style={{ padding: 0, border: 0, background: 'none' }}>
            <a href="/exams/report-cards" aria-current={byClass ? undefined : 'page'}>
              {t('viewAll')}
            </a>
          </li>
          <li style={{ padding: 0, border: 0, background: 'none' }}>
            <a href="/exams/report-cards?view=class" aria-current={byClass ? 'page' : undefined}>
              {t('viewClass')}
            </a>
          </li>
        </ul>
      </nav>

      {byClass ? (
        <Card elevated>
          <form method="get" action="/exams/report-cards" className="ep-rcw-classpick">
            <input type="hidden" name="view" value="class" />
            <label className="ep-field">
              <span className="ep-field__label">{t('class')}</span>
              <select className="ep-select" name="class" defaultValue={classId ?? ''} required>
                <option value="">{t('selectOption')}</option>
                {classes.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              {t('show')}
            </button>
          </form>
          {classId && klass ? (
            cards.length ? (
              <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-4)' }}>
                <table className="ep-table">
                  <caption className="ep-sr-only">{t('cardsOfClass', { cls: klass.name })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('cardCol')}</th>
                      <th scope="col">{t('publishCol')}</th>
                      <th scope="col">{t('pdfsMade')}</th>
                      <th scope="col">{t('readyCol')}</th>
                      <th scope="col">
                        <span className="ep-sr-only">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((x) => (
                      <tr key={x.releaseId}>
                        <td>
                          <Badge tone={KIND_TONE[x.kind]}>{t(`kind_${x.kind}`)}</Badge>{' '}
                          <a href={`/exams/report-cards/${x.releaseId}?tab=publish`}>
                            <strong>
                              {x.termCode} · {x.name}
                            </strong>
                          </a>
                        </td>
                        <td>
                          {x.publish?.status === 'released' ? (
                            <>
                              <Badge tone="success">{t('status_released')}</Badge>
                              <span className="ep-mr-col__desc">
                                {t('classPublishedOn', {
                                  date: when(x.publish.releasedAt),
                                  n: x.publish.notified,
                                })}
                              </span>
                            </>
                          ) : x.publish?.status === 'withdrawn' ? (
                            <>
                              <Badge tone="danger">{t('status_withdrawn')}</Badge>
                              <span className="ep-mr-col__desc">
                                {t('classRevokedOn', {
                                  date: when(x.publish.withdrawnAt),
                                  reason: x.publish.reason ?? '',
                                })}
                              </span>
                            </>
                          ) : (
                            <>
                              <Badge tone="neutral">{t('notPublished')}</Badge>
                              <span className="ep-mr-col__desc">{t(`status_${x.status}`)}</span>
                            </>
                          )}
                        </td>
                        <td>
                          {x.made} / {x.students}
                          {x.held ? (
                            <span className="ep-mr-col__desc">{t('heldCount', { n: x.held })}</span>
                          ) : null}
                        </td>
                        <td>
                          {x.unverified ? (
                            <Badge tone="warning">{t('gapPapers', { n: x.unverified })}</Badge>
                          ) : (
                            <Badge tone="success">{t('papersVerified')}</Badge>
                          )}
                        </td>
                        <td>
                          <span className="ep-mr-row-actions">
                            <a
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              href={`/exams/report-cards/${x.releaseId}?tab=cards`}
                            >
                              {t('open')}
                            </a>
                            {canPublish && x.publish?.status !== 'released' ? (
                              <ConfirmAction
                                action={setClassPublish}
                                fields={{
                                  id: x.releaseId,
                                  back,
                                  classId: klass.id,
                                  status: 'released',
                                  label: `${klass.name} · ${x.termCode}`,
                                }}
                                label={t('publishClass', { cls: x.termCode })}
                                title={t('publishCardTitle', { card: x.name, cls: klass.name })}
                                confirmLabel={t('publishConfirm')}
                                variant="primary"
                              >
                                {t('publishClassBody', { n: x.students, cls: klass.name })}
                                {x.unverified
                                  ? ` ${t('publishClassGaps', { list: t('gapPapers', { n: x.unverified }) })}`
                                  : ''}
                              </ConfirmAction>
                            ) : null}
                            {canPublish && x.publish?.status === 'released' ? (
                              <ConfirmAction
                                action={setClassPublish}
                                fields={{
                                  id: x.releaseId,
                                  back,
                                  classId: klass.id,
                                  status: 'withdrawn',
                                  label: `${klass.name} · ${x.termCode}`,
                                }}
                                label={t('revokeClass', { cls: x.termCode })}
                                title={t('revokeCardTitle', { card: x.name, cls: klass.name })}
                                confirmLabel={t('revoke')}
                                variant="ghost"
                                confirmVariant="danger"
                                reason={{
                                  label: t('withdrawReason'),
                                  placeholder: t('withdrawPlaceholder'),
                                }}
                              >
                                {t('revokeClassBody', { cls: klass.name })}
                              </ConfirmAction>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ marginBottom: 0 }}>{t('noCardsForClass', { cls: klass.name })}</p>
            )
          ) : (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {t('pickClassHelp')}
            </p>
          )}
        </Card>
      ) : releases.length ? (
        <div className="ep-rcw-releases">
          {releases.map((r) => {
            const at = STEP_OF[r.status];
            return (
              <section
                key={r.id}
                className="ep-rcw-release"
                aria-label={`${r.termCode} · ${r.name}`}
              >
                <div>
                  <h3>
                    <a href={`/exams/report-cards/${r.id}`}>
                      {r.termCode} · {r.name}
                    </a>
                  </h3>
                  <span className="ep-mr-pills">
                    <Badge tone={KIND_TONE[r.kind]}>{t(`kind_${r.kind}`)}</Badge>
                    {r.exams.map((e) => (
                      <Badge key={e.id} tone="neutral">
                        {e.code}
                      </Badge>
                    ))}
                  </span>
                  <span className="ep-mr-col__desc">
                    {t('madeOn', { date: when(r.createdAt) })}
                  </span>
                </div>
                <div>
                  <ol className="ep-xstages" aria-label={t('whereItStands')}>
                    {STEPS.map((k, i) => (
                      <li
                        key={k}
                        data-state={
                          i < at || (i === at && r.status === 'released') ? 'done' : undefined
                        }
                        aria-current={i === at && r.status !== 'released' ? 'step' : undefined}
                      >
                        {t(k)}
                      </li>
                    ))}
                  </ol>
                  <ul className="ep-rcw-figs">
                    <li>
                      <Badge tone={RELEASE_TONE[r.status]}>{t(`status_${r.status}`)}</Badge>
                      {r.status === 'released' && r.releasedAt
                        ? ` ${t('onDate', { date: when(r.releasedAt) })}`
                        : ''}
                      {r.status === 'withdrawn' && r.withdrawnReason
                        ? `: ${r.withdrawnReason}`
                        : ''}
                    </li>
                    {r.classCount ? (
                      <li>
                        {t('classesPublished', {
                          n: r.publishedClasses ?? 0,
                          total: r.classCount,
                        })}
                      </li>
                    ) : null}
                    <li>
                      <strong>{r.cards.rendered}</strong> {t('pdfsMade')}
                    </li>
                    <li>
                      <strong>{r.cards.withheld}</strong> {t('withheldFees')}
                    </li>
                    <li>
                      <strong>{r.held ?? 0}</strong> {t('heldLower')}
                    </li>
                    {r.unverified ? (
                      <li>
                        <strong>{r.unverified}</strong> {t('papersUnverified')}
                      </li>
                    ) : null}
                  </ul>
                </div>
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/exams/report-cards/${r.id}`}
                >
                  {t('open')}
                </a>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          <p style={{ margin: 0 }}>
            {t('none')} {canManage ? t('noneHint') : ''}
          </p>
        </Card>
      )}
    </>
  );
}
