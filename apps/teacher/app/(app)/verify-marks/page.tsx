import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { entryStep } from '../marks/actions';

interface Waiting {
  examId: string;
  examCode: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classSectionId: string;
  section: string;
  takers: number;
  entered: number;
  submittedBy: string | null;
  submittedAt: string | null;
}

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : '';

/**
 * Marks submitted by the teachers of the class teacher's sections (docs/design/65, part 2): open the
 * sheet, then verify (it locks them and the results follow) or send them back with what to correct.
 */
export default async function VerifyMarksPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let rows: Waiting[];
  try {
    rows = await bff.api
      .fetch<{ data: Waiting[] }>('/exams/entry-status/waiting')
      .then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) rows = [];
    else throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Marks')}
        title={t(lang, 'Verify marks')}
        description={t(
          lang,
          'Marks your sections’ teachers submitted. Open the sheet to check it, then verify (the marks lock) or send them back with what to correct.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail === 'verify'
            ? t(lang, 'Verified and locked')
            : t(lang, 'Sent back to the teacher')}
          .
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {!rows.length ? (
        <Card>{t(lang, 'Nothing waits for you to verify.')}</Card>
      ) : (
        rows.map((r) => (
          <Card
            key={`${r.examId}-${r.classSectionId}-${r.subjectId}`}
            title={`${r.section} · ${r.subjectName}`}
            actions={<Badge tone="warning">{r.examCode}</Badge>}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <p style={{ marginTop: 0 }}>
              {r.entered} {t(lang, 'of')} {r.takers} {t(lang, 'entered')}
              {r.submittedBy
                ? ` · ${t(lang, 'submitted by')} ${r.submittedBy}, ${when(r.submittedAt)}`
                : ''}
            </p>
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/marks?exam=${r.examId}&pick=${encodeURIComponent(`${r.classSectionId}|${r.subjectId}`)}`}
              >
                {t(lang, 'Open the sheet')}
              </a>
              <form action={entryStep}>
                <input type="hidden" name="examId" value={r.examId} />
                <input type="hidden" name="classSectionId" value={r.classSectionId} />
                <input type="hidden" name="subjectId" value={r.subjectId} />
                <input type="hidden" name="action" value="verify" />
                <input type="hidden" name="back" value="/verify-marks" />
                <Button type="submit" size="sm">
                  {t(lang, 'Verify')}
                </Button>
              </form>
              <form action={entryStep} style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                <input type="hidden" name="examId" value={r.examId} />
                <input type="hidden" name="classSectionId" value={r.classSectionId} />
                <input type="hidden" name="subjectId" value={r.subjectId} />
                <input type="hidden" name="action" value="send-back" />
                <input type="hidden" name="back" value="/verify-marks" />
                <input
                  className="ep-input"
                  name="note"
                  aria-label={`${t(lang, 'What to correct')} · ${r.section} ${r.subjectName}`}
                  placeholder={t(lang, 'What to correct')}
                  required
                  minLength={3}
                  maxLength={500}
                  style={{ width: 180 }}
                />
                <Button type="submit" size="sm" variant="ghost">
                  {t(lang, 'Send back')}
                </Button>
              </form>
            </div>
          </Card>
        ))
      )}
    </main>
  );
}
