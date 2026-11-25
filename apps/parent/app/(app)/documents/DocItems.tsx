import { Badge } from '@edupro/ui';
import { AckButton } from '@/components/AckButton';
import { FileLinks } from '@/components/FileLinks';
import { t, type Lang } from '@/lib/i18n';

export interface FamilyDoc {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  remark: string | null;
  section: string | null;
  fileIds: string[];
  publishAt: string;
  ackRequired: boolean;
  ackedFor: string[];
  postedBy: string | null;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A page of the papers the teachers and the school shared, latest first, each with its kind. */
export function DocItems({
  items,
  lang,
  kid,
}: {
  items: FamilyDoc[];
  lang: Lang;
  kid: { id: string } | null;
}) {
  return (
    <>
      {items.map((d) => (
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
    </>
  );
}
