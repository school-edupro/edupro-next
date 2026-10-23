'use client';
import { useRouter } from 'next/navigation';
import { AdmissionFormFill, type AdmissionFormDef, type UploadedFile } from '@edupro/ui';
import { saveDeskStep, submitDeskForm, uploadDeskFile } from '@/lib/admission-desk-actions';

/** The registration form as the office fills it for a walk-in parent, or reads it (docs/design/39, part 3). */
export function DeskForm({
  id,
  def,
  options,
  answers,
  files,
  readOnly,
}: {
  id: string;
  def: AdmissionFormDef;
  options: Record<string, string[]>;
  answers: Record<string, unknown>;
  files: Record<string, UploadedFile>;
  readOnly: boolean;
}) {
  const router = useRouter();
  return (
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
  );
}
