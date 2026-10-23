'use client';
import { useRouter } from 'next/navigation';
import { AdmissionFormFill, type AdmissionFormDef, type UploadedFile } from '@edupro/ui';
import {
  lookupSibling,
  saveAdmissionStep,
  submitAdmission,
} from '@/app/[school]/admission/actions';

/** The family's registration form: each tab saved on Next, uploads through our route, then submit. */
export function AdmissionApplicationForm({
  id,
  def,
  options,
  answers,
  files,
  onlyFields,
  submitLabel,
  readOnly = false,
}: {
  id: string;
  def: AdmissionFormDef;
  options: Record<string, string[]>;
  answers: Record<string, unknown>;
  files: Record<string, UploadedFile>;
  onlyFields: string[] | null;
  submitLabel?: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  return (
    <AdmissionFormFill
      def={def}
      options={options}
      initial={answers as never}
      files={files}
      fileUrl={(fileId) => `/api/admission/file/${fileId}`}
      readOnly={readOnly}
      onlyFields={onlyFields ?? undefined}
      submitLabel={submitLabel}
      onSaveStep={(a, step) => saveAdmissionStep(id, a, step)}
      onSubmit={async (a) => {
        const out = await submitAdmission(id, a);
        if (out.ok) router.refresh();
        return out;
      }}
      onLookupSibling={lookupSibling}
      onUpload={async (field, file) => {
        const fd = new FormData();
        fd.set('applicationId', id);
        fd.set('fieldKey', field.key);
        fd.set('file', file);
        const res = await fetch('/api/admission/upload', { method: 'POST', body: fd });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error ?? 'Upload failed');
        return { fileId: body.fileId, name: body.name, contentType: body.contentType };
      }}
    />
  );
}
