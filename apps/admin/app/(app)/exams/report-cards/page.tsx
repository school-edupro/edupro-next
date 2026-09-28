import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { rcCreateRelease, rcRenderBatch, rcRenderOne, rcSetReleaseStatus } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Exam, ReportCardRelease, ReportCardStatus, ReportCardTemplate } from '@/lib/types';

const BANDS = ['primary', 'middle', 'secondary', 'senior'] as const;

/** Sprint 17: term releases and batch rendering of report cards. */
export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    release?: string;
    section?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, r, me, releases, templates, exams, sections] = await Promise.all([
    getTranslations('pages.exams_report_cards'),
    getTranslations('reportCards'),
    getMe(),
    apiFetch<{ data: ReportCardRelease[] }>('/exams/report-cards/releases').then((x) => x.data),
    apiFetch<{ data: ReportCardTemplate[] }>('/exams/report-cards/templates').then((x) => x.data),
    apiFetch<{ data: Exam[] }>('/exams').then((x) => x.data),
    sectionOptions(),
  ]);
  const canManage = me.permissions.includes('exams.report_card.manage');
  const release = releases.find((x) => x.id === sp.release) ?? releases[0] ?? null;
  const sectionId = sp.section ?? sections[0]?.value;
  const cards =
    release && sectionId
      ? await apiFetch<{ data: ReportCardStatus[] }>(
          `/exams/report-cards/releases/${release.id}/cards?classSectionId=${sectionId}`,
        ).then((x) => x.data)
      : [];
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/report-cards/templates">
              {r('designer')}
            </a>
            {canManage ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/exams/report-cards?new=1">
                ＋ {r('newRelease')}
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      {canManage && sp.new ? (
        <Card title={r('newRelease')} style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={rcCreateRelease}>
            <FormRow columns={3}>
              <InputField
                id="termCode"
                name="termCode"
                label={r('termCode')}
                required
                pattern="[A-Za-z0-9_]{1,12}"
                placeholder="T1"
              />
              <InputField
                id="name"
                name="name"
                label={r('name')}
                required
                maxLength={120}
                placeholder="Term 1 (2026-27)"
              />
              <InputField
                id="defaulterMin"
                name="defaulterMin"
                label={r('defaulterMin')}
                type="number"
                min={0}
                step="1"
                defaultValue="0"
              />
            </FormRow>
            <div className="ep-kicker">{r('exams')}</div>
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                flexWrap: 'wrap',
                margin: 'var(--sp-2) 0 var(--sp-3)',
              }}
            >
              {exams.map((ex) => (
                <label
                  key={ex.id}
                  style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                >
                  <input type="checkbox" name="examIds" value={ex.id} /> {ex.code} · {ex.name}
                </label>
              ))}
            </div>
            <div className="ep-kicker">{r('templates')}</div>
            <FormRow columns={4}>
              {BANDS.map((b) => (
                <SelectField
                  key={b}
                  id={`t-${b}`}
                  name={`template:${b}`}
                  label={b}
                  options={[
                    { value: '', label: '— default —' },
                    ...templates
                      .filter((x) => x.band === b && x.status === 'active')
                      .map((x) => ({ value: x.id, label: x.name })),
                  ]}
                />
              ))}
            </FormRow>
            <label
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-2)',
                alignItems: 'center',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <input type="checkbox" name="hideDefaulters" /> {r('hideDefaulters')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">{r('create')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'minmax(360px, 1fr) 2fr',
        }}
      >
        <Card title={r('releases')}>
          <DataTable<ReportCardRelease>
            caption={r('releases')}
            density="dense"
            columns={[
              {
                key: 'n',
                header: r('name'),
                render: (x) => (
                  <a href={`/exams/report-cards?release=${x.id}`}>
                    <strong>{x.termCode}</strong> · {x.name}
                    <div className="ep-kicker">{x.exams.map((e) => e.code).join(', ')}</div>
                  </a>
                ),
              },
              {
                key: 's',
                header: r('status'),
                render: (x) => (
                  <Badge
                    tone={
                      x.status === 'released'
                        ? 'success'
                        : x.status === 'withdrawn'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {x.status}
                  </Badge>
                ),
              },
              {
                key: 'c',
                header: r('cards'),
                render: (x) =>
                  `${x.cards.rendered} ${r('rendered')} · ${x.cards.withheld} ${r('withheld')}`,
              },
              {
                key: 'a',
                header: '',
                render: (x) =>
                  canManage ? (
                    <form action={rcSetReleaseStatus}>
                      <input type="hidden" name="id" value={x.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={x.status === 'released' ? 'withdrawn' : 'released'}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant={x.status === 'released' ? 'ghost' : 'secondary'}
                      >
                        {x.status === 'released' ? r('withdraw') : r('release')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={releases}
            rowKey={(x) => x.id}
            emptyTitle={r('noReleases')}
          />
        </Card>
        {release ? (
          <Card
            title={`${release.termCode} · ${release.name}`}
            actions={
              <form
                method="get"
                style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
              >
                <input type="hidden" name="release" value={release.id} />
                <SelectField
                  id="section"
                  name="section"
                  label={r('section')}
                  defaultValue={sectionId ?? ''}
                  options={sections}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {r('open')}
                </Button>
              </form>
            }
          >
            {canManage && sectionId ? (
              <form action={rcRenderBatch} style={{ marginBottom: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={release.id} />
                <input type="hidden" name="classSectionId" value={sectionId} />
                <Button type="submit" size="sm">
                  {r('renderBatch')}
                </Button>
              </form>
            ) : null}
            <DataTable<ReportCardStatus>
              caption={r('cards')}
              density="dense"
              columns={[
                { key: 'r', header: '#', numeric: true, render: (x) => x.rollNo ?? '' },
                {
                  key: 'n',
                  header: r('pupil'),
                  render: (x) => (
                    <>
                      {x.name}
                      <div className="ep-kicker">{x.admissionNo}</div>
                    </>
                  ),
                },
                {
                  key: 'w',
                  header: r('withheld'),
                  render: (x) =>
                    x.withheld ? (
                      <Badge tone="danger">{x.withheldReason ?? r('withheld')}</Badge>
                    ) : (
                      ''
                    ),
                },
                {
                  key: 'e',
                  header: r('exportStatus'),
                  render: (x) =>
                    x.exportId && x.exportStatus === 'ready' ? (
                      <a href={`/reports/exports/${x.exportId}/download`}>{r('download')}</a>
                    ) : (
                      (x.exportStatus ?? '')
                    ),
                },
                {
                  key: 'a',
                  header: '',
                  render: (x) => (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/api/report-cards/preview?releaseId=${release.id}&studentId=${x.studentId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r('preview')}
                      </a>
                      {canManage ? (
                        <form action={rcRenderOne}>
                          <input type="hidden" name="id" value={release.id} />
                          <input type="hidden" name="classSectionId" value={sectionId ?? ''} />
                          <input type="hidden" name="studentId" value={x.studentId} />
                          <Button type="submit" size="sm" variant="ghost">
                            {r('renderOne')}
                          </Button>
                        </form>
                      ) : null}
                    </span>
                  ),
                },
              ]}
              rows={cards}
              rowKey={(x) => x.studentId}
              emptyTitle="—"
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
