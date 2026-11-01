import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { NewReleaseDialog } from '@/components/exams/rc/NewReleaseDialog';
import { apiFetch, getMe } from '@/lib/api';
import { RELEASE_TONE, STEP_OF, STEPS } from '@/lib/report-card-release';
import type { Exam, ReportCardRelease } from '@/lib/types';

/**
 * Report cards (docs/design/65): the term releases — each with its exams, where it stands (draft, with
 * the principal, published) and its cards — and a new release in a dialog. A release opens its
 * workspace: Set-up, Readiness, Cards, Publish.
 */
export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, releases, exams, tp, t, locale] = await Promise.all([
    getMe(),
    apiFetch<{ data: ReportCardRelease[] }>('/exams/report-cards/releases').then((x) => x.data),
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
        }).format(new Date(iso))
      : '';
  const canManage = me.permissions.includes('exams.report_card.manage');
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
      {releases.length ? (
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
