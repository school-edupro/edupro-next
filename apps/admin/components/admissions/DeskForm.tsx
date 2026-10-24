'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  AdmissionFormFill,
  type AdmissionAnswers,
  type AdmissionFormDef,
  type UploadedFile,
} from '@edupro/ui';
import { saveDeskStep, submitDeskForm, uploadDeskFile } from '@/lib/admission-desk-actions';

/** The registration form as the office fills it for a walk-in parent, or reads it (docs/design/39, part 3). */
export function DeskForm({
  id,
  def,
  options,
  answers,
  files,
  readOnly,
  canAllowDuplicate = false,
}: {
  id: string;
  def: AdmissionFormDef;
  options: Record<string, string[]>;
  answers: Record<string, unknown>;
  files: Record<string, UploadedFile>;
  readOnly: boolean;
  /** an admission admin may register the same child a second time in the year, with a reason */
  canAllowDuplicate?: boolean;
}) {
  const router = useRouter();
  // the child already holds a registration this year: the answers kept for "register anyway"
  const [dup, setDup] = useState<{ answers: AdmissionAnswers; message: string } | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {dup && canAllowDuplicate ? (
        <div className="ep-alert ep-alert--warning ep-desk-dup" role="alert">
          <p style={{ margin: 0 }}>{dup.message}</p>
          <label className="ep-field">
            <span className="ep-field__label">Reason to register this child again (admin)</span>
            <textarea
              className="ep-input"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {note ? <p style={{ margin: 0 }}>{note}</p> : null}
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--danger ep-btn--sm"
              disabled={pending || reason.trim().length < 5}
              onClick={() =>
                start(async () => {
                  const out = await submitDeskForm(id, dup.answers, reason.trim());
                  if (out.ok) {
                    setDup(null);
                    router.refresh();
                  } else setNote(out.message ?? 'Could not submit');
                })
              }
            >
              Register anyway
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setDup(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <AdmissionFormFill
        def={def}
        options={options}
        initial={answers as never}
        files={files}
        readOnly={readOnly}
        fileUrl={(fileId) => `/api/admission-desk/file/${id}:${fileId}`}
        submitLabel="Submit the form"
        onSaveStep={(a, step) => saveDeskStep(id, a, step)}
        onSubmit={async (a) => {
          const out = await submitDeskForm(id, a);
          if (out.ok) router.refresh();
          else if (out.type?.endsWith('duplicate_child'))
            setDup({ answers: a, message: out.message ?? '' });
          return out;
        }}
        onUpload={async (field, file) => {
          const fd = new FormData();
          fd.set('id', id);
          fd.set('fieldKey', field.key);
          fd.set('file', file);
          const out = await uploadDeskFile(fd);
          if (!out.ok) throw new Error(out.error);
          return { fileId: out.fileId, name: out.name, contentType: out.contentType };
        }}
      />
    </>
  );
}
