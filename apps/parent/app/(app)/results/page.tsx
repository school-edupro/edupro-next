import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { queueMyReportCardPdf } from './actions';

interface Term {
  releaseId: string;
  termCode: string;
  name: string;
  releasedAt: string | null;
  exams: Array<{
    code: string;
    name: string;
    pct: string | null;
    grade: string | null;
    result: string | null;
    rank: number | null;
  }>;
  withheld: boolean;
}
interface Res {
  children: Array<{ student: { id: string; name: string; section: string | null }; terms: Term[] }>;
}

/** Sprint 17: released results of the family's children and the report-card PDF. */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let res: Res;
  try {
    res = await bff.api.fetch<Res>('/exams/mine/results');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Results')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{ export: { id: string; status: string }; download: { url: string } | null }>(
          `/exams/mine/exports/${sp.export}`,
        )
        .catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Results')}
        title={t(lang, 'Report cards and progress')}
        description={t(
          lang,
          'Terms the school has released. The report card PDF is prepared on request.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error === 'report_card.withheld'
            ? t(lang, 'The report card is available once the fee dues are cleared.')
            : sp.detail || sp.error}
        </div>
      ) : null}
      {exportStatus ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {exportStatus.download ? (
            <a href={exportStatus.download.url}>{t(lang, 'Download the report card PDF')}</a>
          ) : (
            <>
              {t(lang, 'The report card PDF is being prepared.')}{' '}
              <a href={`/results?export=${exportStatus.export.id}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      {res.children.map((c) => (
        <Card
          key={c.student.id}
          title={`${c.student.name}${c.student.section ? ` · ${c.student.section}` : ''}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {c.terms.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No results released yet.')}</p>
          ) : null}
          {c.terms.map((term) => (
            <div
              key={term.releaseId}
              style={{
                borderTop: '1px solid var(--border-default)',
                paddingTop: 'var(--sp-2)',
                marginTop: 'var(--sp-2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                }}
              >
                <strong>{term.name}</strong>
                <form action={queueMyReportCardPdf}>
                  <input type="hidden" name="releaseId" value={term.releaseId} />
                  <input type="hidden" name="studentId" value={c.student.id} />
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    {t(lang, 'Report card PDF')}
                  </button>
                </form>
              </div>
              <table
                className="ep-table ep-table--dense"
                style={{ width: '100%', marginTop: 'var(--sp-2)' }}
              >
                <thead>
                  <tr>
                    <th>{t(lang, 'Exam')}</th>
                    <th style={{ textAlign: 'right' }}>%</th>
                    <th>{t(lang, 'Grade')}</th>
                    <th>{t(lang, 'Result')}</th>
                    <th style={{ textAlign: 'right' }}>{t(lang, 'Rank')}</th>
                  </tr>
                </thead>
                <tbody>
                  {term.exams.map((ex) => (
                    <tr key={ex.code}>
                      <td>{ex.name}</td>
                      <td style={{ textAlign: 'right' }}>{ex.pct ?? '—'}</td>
                      <td>{ex.grade ?? ''}</td>
                      <td>
                        {ex.result ? (
                          <Badge
                            tone={
                              ex.result === 'pass'
                                ? 'success'
                                : ex.result === 'fail'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {t(
                              lang,
                              ex.result === 'pass'
                                ? 'Pass'
                                : ex.result === 'fail'
                                  ? 'Needs improvement'
                                  : 'Incomplete',
                            )}
                          </Badge>
                        ) : (
                          ''
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{ex.rank ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      ))}
    </main>
  );
}
