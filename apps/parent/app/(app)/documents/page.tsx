import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { AckButton } from '@/components/AckButton';
import { ChildSwitch } from '@/components/ChildSwitch';
import { FileLinks } from '@/components/FileLinks';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Doc {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  remark: string | null;
  classSectionId: string | null;
  section: string | null;
  subject: string | null;
  fileIds: string[];
  publishAt: string;
  ackRequired: boolean;
  ackedFor: string[];
  postedBy: string | null;
}
const GROUPS: Array<[string, string, string[]]> = [
  ['class', 'For the class', ['session_plan', 'curriculum', 'date_sheet', 'other']],
  ['school', 'From the school', ['magazine', 'almanac']],
];
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Class documents for the family: the session plan, the curriculum and date sheets of the child's class,
 * and the school's magazine and almanac. Each shows from the time the school published it.
 */
export default async function FamilyDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild();
  let docs: Doc[] = [];
  let kinds: Array<{ value: string; label: string }> = [];
  try {
    const r = await bff.api.fetch<{ data: Doc[]; kinds: typeof kinds }>('/academics/documents');
    docs = r.data;
    kinds = r.kinds;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const kind = kinds.some((k) => k.value === sp.kind) ? sp.kind! : '';
  const mine = docs.filter(
    (d) => (!d.section || !kid?.section || d.section === kid.section) && (!kind || d.kind === kind),
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Academics')}
        title={t(lang, 'Session plan, curriculum and date sheets')}
        description={t(lang, 'What the teachers and the school shared for this session.')}
      />
      <ChildSwitch lang={lang} back="/documents" />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Kind')}
        style={{ marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}
      >
        <a href="/documents" aria-current={kind === '' ? 'page' : undefined}>
          {t(lang, 'All')}
        </a>
        {kinds
          .filter((k) => docs.some((d) => d.kind === k.value))
          .map((k) => (
            <a
              key={k.value}
              href={`/documents?kind=${k.value}`}
              aria-current={kind === k.value ? 'page' : undefined}
            >
              {t(lang, k.label)}
            </a>
          ))}
      </nav>
      {mine.length === 0 ? <Card>{t(lang, 'Nothing has been shared yet.')}</Card> : null}
      {GROUPS.map(([key, title, list]) => {
        const rows = mine.filter((d) => list.includes(d.kind));
        if (!rows.length) return null;
        return (
          <Card key={key} title={t(lang, title)} style={{ marginBottom: 'var(--sp-3)' }}>
            {rows.map((d) => (
              <div
                key={d.id}
                style={{ padding: 'var(--sp-3) 0', borderTop: '1px solid var(--border-strong)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Badge tone="info">{t(lang, d.kindLabel)}</Badge>
                  <strong>{d.title}</strong>
                </div>
                {d.remark ? (
                  <div
                    className="ep-richtext"
                    style={{ margin: 'var(--sp-1) 0' }}
                    dangerouslySetInnerHTML={{ __html: d.remark }}
                  />
                ) : null}
                <div className="pp-attachments ep-filecell">
                  <span>{t(lang, 'Attachments')}</span>
                  {d.fileIds.map((f, i) => (
                    <FileLinks
                      key={f}
                      url={`/api/attachment/document/${d.id}/${f}`}
                      saveUrl={`/api/attachment/document/${d.id}/${f}?save=1`}
                      label={`${t(lang, 'Attachment')} ${String(i + 1)}`}
                      viewLabel={t(lang, 'View')}
                      saveLabel={t(lang, 'Download')}
                    />
                  ))}
                </div>
                <div className="ep-kicker">
                  {[d.postedBy, d.section, `${t(lang, 'Published')} ${when(d.publishAt)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {d.ackRequired && kid ? (
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <AckButton
                      type="document"
                      id={d.id}
                      studentId={kid.id}
                      done={d.ackedFor.includes(kid.id)}
                      back="/documents"
                      label={t(lang, 'Acknowledge')}
                      doneLabel={t(lang, 'Acknowledged')}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        );
      })}
    </main>
  );
}
