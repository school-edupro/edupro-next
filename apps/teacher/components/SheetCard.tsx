import { Card } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';
import { uploadSheet } from '@/lib/sheet-actions';
import { SheetUpload } from './SheetUpload';

/**
 * "By Excel" for a section (docs/design/71): download what the teacher enters (already filled with what
 * is entered), fill it and upload it; the rows are checked before anything is saved.
 */
export function SheetCard({
  kind,
  examId,
  sectionId,
  lang,
  canUpload,
  help,
}: {
  kind: 'indicators' | 'remarks' | 'health';
  examId: string;
  sectionId: string;
  lang: Lang;
  canUpload: boolean;
  help: string;
}) {
  return (
    <Card title={t(lang, 'By Excel')} style={{ marginTop: 'var(--sp-3)' }}>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {help}
      </p>
      <p>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/sheet?kind=${kind}&exam=${examId}&section=${sectionId}`}
        >
          {t(lang, 'Download the sheet')}
        </a>
      </p>
      {canUpload ? (
        <SheetUpload
          upload={uploadSheet.bind(null, kind, examId, sectionId)}
          words={{
            file: t(lang, 'Upload the filled sheet (.xlsx)'),
            checking: t(lang, 'Checking the sheet…'),
            rows: t(lang, 'rows read'),
            ready: t(lang, 'ready to save'),
            errors: t(lang, 'with a problem'),
            save: t(lang, 'Save the rows'),
            saved: t(lang, 'Saved'),
            nothing: t(lang, 'Nothing was saved.'),
            tooLarge: t(lang, 'The file is larger than 1.4 MB'),
            unreadable: t(lang, 'The file could not be read'),
            row: t(lang, 'Row'),
            admissionNo: t(lang, 'Admission no'),
            pupil: t(lang, 'Pupil'),
            problem: t(lang, 'Problem'),
          }}
        />
      ) : null}
    </Card>
  );
}
