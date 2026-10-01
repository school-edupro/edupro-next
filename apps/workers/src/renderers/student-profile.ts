import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  applies,
  loadPortalPolicy,
  readStudentProfile,
  tenantForJob,
  type Db,
  type JobEnvelope,
  type ProfileField,
  type ProfileValues,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { istStamp, letterhead, type Letterhead } from './report-builder';

/**
 * The student profile printout (A4): the school letterhead, the student's, father's and mother's
 * photos with the key facts, then every section of the profile with the fields that apply, the
 * documents on file, a declaration and signature lines. ID numbers are masked unless the person who
 * asked for the print may see them (checked here, not taken from the request).
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DOC_LABEL: Record<string, string> = {
  photo: 'Student photo',
  birth_certificate: 'Birth certificate',
  address_proof: 'Residence proof',
  aadhaar: 'Aadhaar card',
  transfer_certificate: 'Transfer certificate',
  category_certificate: 'Caste / category certificate',
  medical: 'Medical / disability certificate',
  qualification: 'Previous report card',
  bank: 'Bank passbook or cheque',
  pan: 'PAN card',
  other: 'Other document',
};

async function imageUri(storage: StorageDriver, key: string | null, type: string | null) {
  if (!key || !type || !/^image\/(png|jpe?g|webp)$/.test(type)) return null;
  try {
    const bytes = await storage.read(key);
    return bytes.length <= 3 * 1024 * 1024
      ? `data:${type};base64,${bytes.toString('base64')}`
      : null;
  } catch {
    return null;
  }
}

const show = (f: ProfileField | undefined, v: ProfileValues[string]): string => {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (f?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s))
    return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
  return s;
};

export async function renderStudentProfile(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
): Promise<{ html: string; width: string; height: string }> {
  const studentId = String(params.studentId ?? '');
  // a parent or student downloading from the portal: only what that portal shows
  const audience =
    params.audience === 'parent' || params.audience === 'student' ? params.audience : null;
  const tenant = tenantForJob(envelope);
  const data = await db.withTenant(tenant, async (c) => {
    let visible: (key: string) => boolean = () => true;
    if (audience) {
      const link = envelope.userId
        ? await c.query(
            `SELECT 1 FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL AND (s.user_id = $2 OR EXISTS (
               SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND g.user_id = $2 AND g.deleted_at IS NULL))`,
            [studentId, envelope.userId],
          )
        : { rowCount: 0 };
      if (!link.rowCount) throw new Error(`user is not linked to student ${studentId}`);
      const policy = await loadPortalPolicy(c);
      visible = (key) => policy.fields[audience][key] !== 'hidden';
    }
    // full ID numbers only when the requester holds people.sensitive.view today (or it is their own child)
    const perm = audience
      ? { rowCount: 1 }
      : envelope.userId
        ? await c.query(
            `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
              AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND rp.permission_code = 'people.sensitive.view'
            LIMIT 1`,
            [envelope.userId],
          )
        : { rowCount: 0 };
    const snap = await readStudentProfile(c, studentId, {
      showSensitive: (perm.rowCount ?? 0) > 0,
    });
    if (!snap) throw new Error(`student ${studentId} not found`);
    const ids = Object.values(snap.photos).filter(Boolean);
    const files = ids.length
      ? await c.query<{ id: string; object_key: string; content_type: string }>(
          `SELECT id::text, object_key, content_type FROM files WHERE id = ANY($1::bigint[]) AND status = 'ready'`,
          [ids],
        )
      : { rows: [] as Array<{ id: string; object_key: string; content_type: string }> };
    const docs = await c.query<{ kind: string; verified: boolean }>(
      `SELECT kind::text, bool_or(verified_at IS NOT NULL) AS verified FROM person_documents
        WHERE person_type = 'student' AND person_id = $1 AND deleted_at IS NULL GROUP BY kind`,
      [studentId],
    );
    return { snap, files: files.rows, docs: docs.rows, visible };
  });
  const visible = data.visible;
  const lh: Letterhead = await letterhead(db, storage, tenant);
  const fileOf = new Map(data.files.map((f) => [f.id, f]));
  const photo = async (who: 'student' | 'father' | 'mother') => {
    const id = data.snap.photos[who];
    const f = id ? fileOf.get(id) : undefined;
    return imageUri(storage, f?.object_key ?? null, f?.content_type ?? null);
  };
  const [studentPhoto, fatherPhoto, motherPhoto] = await Promise.all([
    photo('student'),
    photo('father'),
    photo('mother'),
  ]);
  const v = data.snap.values;
  const byKey = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));
  const val = (k: string) => (visible(k) ? esc(show(byKey.get(k), v[k] ?? null)) : '');
  const e = data.snap.enrolment;

  const photoBox = (uri: string | null, label: string, name: string, mobile: string) => `
    <figure class="ph">
      ${uri ? `<img src="${uri}" alt="" />` : '<div class="ph-empty">Photo</div>'}
      <figcaption><strong>${esc(label)}</strong>${name ? `<br />${name}` : ''}${mobile ? `<br />${mobile}` : ''}</figcaption>
    </figure>`;

  const facts: Array<[string, string, string?]> = [
    ['Admission No', esc(data.snap.admissionNo)],
    ['Class & Section', e ? esc(`${e.className} ${e.section}`) : ''],
    ['Roll No', e?.rollNo ? String(e.rollNo) : ''],
    ['Academic Year', e ? esc(e.academicYear) : ''],
    [
      'Date of Birth',
      `${val('dob')}${v.age !== null && v.age !== undefined && visible('dob') ? ` (${String(v.age)} yrs)` : ''}`,
      'dob',
    ],
    ['Gender', val('gender'), 'gender'],
    ['Blood Group', val('blood_group'), 'blood_group'],
    ['Category', val('category'), 'category'],
    ['House', val('house'), 'house'],
    ['Day Scholar / Hosteller', val('boarding'), 'boarding'],
  ];
  const keyFacts = facts.filter(([, , key]) => !key || visible(key));

  // every section, the fields that apply; parents' photo fields and enrolment facts shown above are skipped
  const skip = new Set([
    'photo_ref',
    'father_photo',
    'mother_photo',
    'guardian_photo',
    'academic_year',
    'class',
    'section',
    'roll_no',
  ]);
  // the documents checklist becomes the table below (with the remarks after it)
  const sections = PROFILE_SECTIONS.filter((s) => s.id !== 'documents')
    .map((s) => {
      const fields = PROFILE_FIELDS.filter(
        (f) => f.section === s.id && !skip.has(f.key) && visible(f.key) && applies(f, v),
      );
      const hasAny = fields.some(
        (f) => v[f.key] !== null && v[f.key] !== undefined && v[f.key] !== '',
      );
      if ((s.id === 'guardian' && !hasAny) || !fields.length) return '';
      const cells = fields
        .map(
          (f) =>
            `<div class="kv"><span>${esc(f.label)}</span><b>${val(f.key) || '&nbsp;'}</b></div>`,
        )
        .join('');
      return `<section class="sec"><h3>${esc(s.title)}</h3><div class="grid">${cells}</div></section>`;
    })
    .join('');

  const docRows = Object.keys(DOC_LABEL)
    .map((k) => {
      const d = data.docs.find((x) => x.kind === k);
      if (!d && !['photo', 'birth_certificate', 'address_proof', 'aadhaar'].includes(k)) return '';
      return `<tr><td>${esc(DOC_LABEL[k]!)}</td><td>${d ? 'On file' : 'Not submitted'}</td><td>${d?.verified ? 'Checked' : ''}</td></tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Student profile ${esc(data.snap.admissionNo)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 11mm 16mm;
    @bottom-left { content: "${esc(lh.name).replace(/"/g, '')} · Student profile ${esc(data.snap.admissionNo)}"; font: 7.5px Arial, sans-serif; color: #52606D; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5px Arial, sans-serif; color: #52606D; }
  }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: 9.5px; margin: 0; }
  .lh { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #00265D; padding-bottom: 6px; }
  .lh img { height: 48px; }
  .lh .school { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 16px; font-weight: 700; color: #00265D; }
  .lh .sub { color: #52606D; font-size: 9px; }
  .title { display: flex; justify-content: space-between; align-items: baseline; margin: 8px 0 6px; }
  .title h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; color: #00265D; margin: 0; }
  .title span { color: #52606D; font-size: 8.5px; }
  .title small { font-size: 10px; color: #52606D; font-weight: 400; }
  .top { display: grid; grid-template-columns: 34mm 1fr 30mm 30mm; gap: 8px; align-items: start; border: 1px solid #D9E2EC; border-radius: 6px; padding: 8px; }
  .ph { margin: 0; text-align: center; font-size: 8.5px; }
  .ph img, .ph-empty { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 4px; border: 1px solid #00A0C6; background: #F5F7FA; }
  .ph-empty { display: flex; align-items: center; justify-content: center; color: #9AA5B1; }
  .name { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 15px; font-weight: 700; color: #00265D; margin-bottom: 4px; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; }
  .facts div { display: flex; justify-content: space-between; border-bottom: 1px dotted #D9E2EC; padding: 1.5px 0; }
  .facts span { color: #52606D; }
  .sec { break-inside: avoid; margin-top: 7px; }
  .sec h3 { font-size: 10px; margin: 0 0 3px; padding: 3px 6px; background: #00265D; color: #fff; border-radius: 3px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  .kv { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #EEF2F6; padding: 2px 2px; }
  .kv span { color: #52606D; }
  .kv b { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border-bottom: 1px solid #EEF2F6; padding: 2.5px 4px; text-align: left; }
  .decl { margin-top: 10px; break-inside: avoid; }
  .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 26px; text-align: center; color: #52606D; }
  .signs div { border-top: 1px solid #52606D; padding-top: 3px; }
</style></head>
<body>
  <div class="lh">
    ${lh.logo ? `<img src="${lh.logo.dataUri}" alt="" />` : ''}
    <div>
      <div class="school">${esc(lh.name)}</div>
      ${lh.address ? `<div class="sub">${esc(lh.address)}</div>` : ''}
      ${lh.affiliation || lh.contact ? `<div class="sub">${esc([lh.affiliation, lh.contact].filter(Boolean).join(' · '))}</div>` : ''}
    </div>
  </div>
  <div class="title"><h1>Student Profile${audience ? ` <small>· ${audience === 'parent' ? 'Parent' : 'Student'} copy</small>` : ''}</h1><span>${audience ? 'Downloaded from the portal' : 'Printed'} ${esc(istStamp(new Date()))} · Profile ${String(data.snap.completeness.percent)}% complete</span></div>
  <div class="top">
    ${photoBox(studentPhoto, 'Student', '', '')}
    <div>
      <div class="name">${esc(data.snap.displayName)}</div>
      <div class="facts">${keyFacts.map(([k, x]) => `<div><span>${esc(k)}</span><b>${x}</b></div>`).join('')}</div>
    </div>
    ${photoBox(fatherPhoto, 'Father', val('father_name'), val('father_mobile'))}
    ${photoBox(motherPhoto, 'Mother', val('mother_name'), val('mother_mobile'))}
  </div>
  ${sections}
  <section class="sec"><h3>Documents</h3>
    <table><thead><tr><th>Document</th><th>Status</th><th>Verified</th></tr></thead><tbody>${docRows}</tbody></table>
    ${val('remarks') ? `<p><b>Remarks:</b> ${val('remarks')}</p>` : ''}
  </section>
  <div class="decl">
    I confirm that the details above are correct. I will inform the school of any change.
    <div class="signs"><div>Signature of parent / guardian</div><div>Class teacher</div><div>Principal</div></div>
  </div>
</body></html>`;
  return { html, width: '210mm', height: '297mm' };
}
