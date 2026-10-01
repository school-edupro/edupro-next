import { Badge, Card } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { ConfirmAction } from './ConfirmAction';
import {
  studentDocumentRemove,
  studentDocumentReplace,
  studentDocumentUpload,
  studentDocumentVerify,
} from '@/lib/actions';
import { ddmmyyyy, type ProfileSnapshot } from '@/lib/profile';
import type { PersonDocument, Student360 } from '@/lib/types';

export const DOCUMENT_KINDS: Array<{ id: string; label: string; number?: string }> = [
  { id: 'photo', label: 'Student photo' },
  { id: 'birth_certificate', label: 'Birth certificate', number: 'Certificate no' },
  { id: 'address_proof', label: 'Residence proof', number: 'Document no' },
  { id: 'aadhaar', label: 'Aadhaar card', number: 'Aadhaar no' },
  { id: 'transfer_certificate', label: 'Transfer certificate (previous school)', number: 'TC no' },
  { id: 'category_certificate', label: 'Caste / category certificate', number: 'Certificate no' },
  { id: 'medical', label: 'Medical / disability certificate', number: 'Certificate no (UDID)' },
  { id: 'qualification', label: 'Previous report card' },
  { id: 'bank', label: 'Bank passbook or cheque', number: 'Account no' },
  { id: 'pan', label: 'PAN card', number: 'PAN' },
  { id: 'other', label: 'Other document' },
];
const kindLabel = (k: string) => DOCUMENT_KINDS.find((d) => d.id === k)?.label ?? k;

/** Which documents this student is expected to have, from the sheet's checklist and the profile. */
export function expectedDocuments(profile: ProfileSnapshot | null): string[] {
  const v = profile?.values ?? {};
  const out = ['photo', 'birth_certificate', 'address_proof', 'aadhaar'];
  if (['OBC', 'OBC (Non-Creamy Layer)', 'SC', 'ST'].includes(String(v.category ?? '')))
    out.push('category_certificate');
  if (v.cwsn === 'Yes') out.push('medical');
  if (v.previous_school_name) out.push('transfer_certificate');
  return out;
}

/**
 * Documents of a student: what is expected and what is on file, upload with number and dates, open,
 * replace (the old file stays in history), mark as checked against the original, and remove.
 */
export function StudentDocuments({
  student,
  profile,
  canEdit,
}: {
  student: Student360;
  profile: ProfileSnapshot | null;
  canEdit: boolean;
}) {
  const docs = student.documents as PersonDocument[];
  const expected = expectedDocuments(profile);
  const have = new Set(docs.map((d) => d.kind));
  return (
    <div className="ep-grid-cards">
      <Card title="Checklist">
        <ul className="ep-checklist">
          {expected.map((k) => (
            <li key={k}>
              <Badge tone={have.has(k) ? 'success' : 'warning'}>
                {have.has(k) ? 'On file' : 'Missing'}
              </Badge>{' '}
              {kindLabel(k)}
            </li>
          ))}
        </ul>
        <p className="ep-field__help">
          Uploading a birth certificate, residence proof, photo or Aadhaar ticks the matching item
          of the profile's document checklist.
        </p>
      </Card>

      {canEdit ? (
        <Card title="Upload a document">
          <form action={studentDocumentUpload} className="ep-profile__grid">
            <input type="hidden" name="id" value={student.id} />
            <input type="hidden" name="tab" value="documents" />
            <label className="ep-field" htmlFor="doc-kind">
              <span className="ep-field__label">Document *</span>
              <select
                id="doc-kind"
                name="kind"
                className="ep-input"
                required
                defaultValue={expected.find((k) => !have.has(k)) ?? 'other'}
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="doc-file">
              <span className="ep-field__label">File *</span>
              <input
                id="doc-file"
                name="file"
                type="file"
                className="ep-input"
                required
                accept="application/pdf,image/jpeg,image/png,image/webp"
              />
              <span className="ep-field__help">PDF, JPG, PNG or WebP, up to 10 MB</span>
            </label>
            <label className="ep-field" htmlFor="doc-number">
              <span className="ep-field__label">Document number</span>
              <input id="doc-number" name="number" className="ep-input" maxLength={40} />
            </label>
            <label className="ep-field" htmlFor="doc-issued">
              <span className="ep-field__label">Issued on</span>
              <input id="doc-issued" name="issuedOn" type="date" className="ep-input" />
            </label>
            <label className="ep-field" htmlFor="doc-expires">
              <span className="ep-field__label">Valid until</span>
              <input id="doc-expires" name="expiresOn" type="date" className="ep-input" />
            </label>
            <label className="ep-field" htmlFor="doc-title">
              <span className="ep-field__label">Note</span>
              <input
                id="doc-title"
                name="title"
                className="ep-input"
                maxLength={120}
                placeholder="e.g. issued by MCD"
              />
            </label>
            <div style={{ alignSelf: 'end' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Upload
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`On file (${String(docs.length)})`} style={{ gridColumn: '1 / -1' }}>
        {docs.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Documents on file">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Number</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">Checked</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const expiring =
                    d.expiresOn && new Date(d.expiresOn) < new Date(Date.now() + 30 * 864e5);
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>
                          <FileLinks
                            href={`/api/files/${d.fileId}/download`}
                            label={kindLabel(d.kind)}
                          />
                        </strong>
                        <div className="ep-field__help">
                          {d.fileName ?? ''}
                          {d.title ? ` · ${d.title}` : ''}
                        </div>
                      </td>
                      <td>{d.number ?? '—'}</td>
                      <td>
                        {d.issuedOn ? `Issued ${ddmmyyyy(d.issuedOn)}` : ''}
                        {d.expiresOn ? (
                          <div>
                            {expiring ? <Badge tone="warning">expires</Badge> : null}{' '}
                            {ddmmyyyy(d.expiresOn)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {d.uploadedAt ? ddmmyyyy(d.uploadedAt) : ''}
                        {d.uploadedBy ? <div className="ep-field__help">{d.uploadedBy}</div> : null}
                      </td>
                      <td>
                        {d.verifiedAt ? (
                          <Badge tone="success">
                            checked{d.verifiedBy ? ` by ${d.verifiedBy}` : ''}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">not checked</Badge>
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <div className="ep-doc-actions">
                            <form action={studentDocumentVerify}>
                              <input type="hidden" name="id" value={student.id} />
                              <input type="hidden" name="docId" value={d.id} />
                              <input
                                type="hidden"
                                name="verified"
                                value={d.verifiedAt ? 'false' : 'true'}
                              />
                              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                {d.verifiedAt ? 'Undo check' : 'Mark checked'}
                              </button>
                            </form>
                            <details>
                              <summary className="ep-btn ep-btn--ghost ep-btn--sm">Replace</summary>
                              <form action={studentDocumentReplace} className="ep-doc-replace">
                                <input type="hidden" name="id" value={student.id} />
                                <input type="hidden" name="docId" value={d.id} />
                                <input type="hidden" name="kind" value={d.kind} />
                                <label className="ep-field" htmlFor={`rep-file-${d.id}`}>
                                  <span className="ep-field__label">New file</span>
                                  <input
                                    id={`rep-file-${d.id}`}
                                    name="file"
                                    type="file"
                                    className="ep-input"
                                    required
                                    accept="application/pdf,image/jpeg,image/png,image/webp"
                                  />
                                </label>
                                <label className="ep-field" htmlFor={`rep-num-${d.id}`}>
                                  <span className="ep-field__label">Number (if it changed)</span>
                                  <input
                                    id={`rep-num-${d.id}`}
                                    name="number"
                                    className="ep-input"
                                    maxLength={40}
                                  />
                                </label>
                                <button
                                  type="submit"
                                  className="ep-btn ep-btn--secondary ep-btn--sm"
                                >
                                  Replace file
                                </button>
                              </form>
                            </details>
                            <ConfirmAction
                              action={studentDocumentRemove}
                              fields={{ id: student.id, docId: d.id, tab: 'documents' }}
                              label="Remove"
                              variant="ghost"
                              title={`Remove ${kindLabel(d.kind)}?`}
                              confirmLabel="Remove"
                              confirmVariant="danger"
                            >
                              <p>
                                The document leaves the student's file. It stays in the history and
                                the audit log.
                              </p>
                            </ConfirmAction>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No documents yet.</p>
        )}
      </Card>
    </div>
  );
}
