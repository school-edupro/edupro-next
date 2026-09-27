import { tenantForJob, type Db, type JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';

export interface IdCardData {
  kind: 'student' | 'employee';
  school: { name: string; shortName: string | null; address: string | null; phone: string | null };
  person: {
    name: string;
    code: string;
    line1: string | null;
    line2: string | null;
    dob: string | null;
    bloodGroup: string | null;
    contact: string | null;
  };
  validTill: string;
  photoDataUri: string | null;
}

const esc = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** CR80 card (85.6 x 54 mm) with the design-system palette; printed front only in Sprint 4. */
export function idCardHtml(d: IdCardData): string {
  const label = d.kind === 'student' ? 'STUDENT' : 'STAFF';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: 85.6mm 54mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: 85.6mm; height: 54mm; font-family: "Source Sans 3", "Noto Sans Devanagari", Arial, sans-serif; color: #1F2933; }
  .card { position: relative; width: 85.6mm; height: 54mm; overflow: hidden; background: #fff; }
  .band { background: #00265D; color: #fff; padding: 2.5mm 3mm 2mm; }
  .band .school { font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 3.4mm; letter-spacing: 0.1mm; }
  .band .addr { font-size: 2.1mm; opacity: 0.85; }
  .body { display: flex; gap: 3mm; padding: 2.5mm 3mm; }
  .photo { width: 20mm; height: 25mm; border-radius: 1.5mm; background: #E4E7EB; object-fit: cover; border: 0.4mm solid #00A0C6; }
  .details { flex: 1; font-size: 2.6mm; line-height: 1.35; }
  .name { font-family: Poppins, Arial, sans-serif; font-weight: 600; font-size: 3.6mm; color: #00265D; margin-bottom: 0.8mm; }
  .row b { color: #52606D; font-weight: 600; margin-right: 1mm; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; align-items: center; padding: 1.5mm 3mm; background: #F5F7FA; font-size: 2.2mm; color: #52606D; }
  .tag { background: #00A0C6; color: #fff; border-radius: 1mm; padding: 0.4mm 1.5mm; font-weight: 600; letter-spacing: 0.15mm; }
  </style></head><body><div class="card">
  <div class="band"><div class="school">${esc(d.school.name)}</div><div class="addr">${esc(d.school.address)}${d.school.phone ? ' · ' + esc(d.school.phone) : ''}</div></div>
  <div class="body">
    ${d.photoDataUri ? `<img class="photo" src="${d.photoDataUri}" alt="">` : '<div class="photo"></div>'}
    <div class="details">
      <div class="name">${esc(d.person.name)}</div>
      <div class="row"><b>${d.kind === 'student' ? 'Adm no' : 'Emp code'}</b>${esc(d.person.code)}</div>
      ${d.person.line1 ? `<div class="row">${esc(d.person.line1)}</div>` : ''}
      ${d.person.line2 ? `<div class="row">${esc(d.person.line2)}</div>` : ''}
      ${d.person.dob ? `<div class="row"><b>DOB</b>${esc(d.person.dob)}</div>` : ''}
      ${d.person.bloodGroup ? `<div class="row"><b>Blood</b>${esc(d.person.bloodGroup)}</div>` : ''}
      ${d.person.contact ? `<div class="row"><b>Contact</b>${esc(d.person.contact)}</div>` : ''}
    </div>
  </div>
  <div class="foot"><span class="tag">${label}</span><span>Valid till ${esc(d.validTill)}</span></div>
  </div></body></html>`;
}

async function photoDataUri(
  storage: StorageDriver,
  objectKey: string | null,
  contentType: string | null,
): Promise<string | null> {
  if (!objectKey) return null;
  try {
    const bytes = await storage.read(objectKey);
    return `data:${contentType ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Loads the card data under the requester's tenant context (row-level security applies). */
export async function loadIdCard(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  rendererId: string,
  params: Record<string, unknown>,
): Promise<IdCardData> {
  const tenant = tenantForJob(envelope);
  if (rendererId === 'student_id_card') {
    const id = String(params.studentId ?? '');
    return db.withTenant(tenant, async (c) => {
      const r = await c.query<{
        name: string;
        admission_no: string;
        dob: string | null;
        blood_group: string | null;
        klass: string | null;
        house: string | null;
        guardian: string | null;
        school: string;
        short_name: string | null;
        address: Record<string, string> | null;
        phone: string | null;
        object_key: string | null;
        content_type: string | null;
        valid_till: string;
      }>(
        `SELECT s.display_name AS name, s.admission_no, to_char(s.dob, 'DD Mon YYYY') AS dob, s.blood_group, s.house,
                (SELECT c.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
                  WHERE e.student_id = s.id AND e.status = 'active' ORDER BY e.joined_on DESC LIMIT 1) AS klass,
                (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS guardian,
                sc.name AS school, sc.short_name, sc.address, sc.contact->>'phone' AS phone, f.object_key, f.content_type,
                to_char((SELECT max(y.end_date) FROM academic_years y WHERE y.status IN ('active','planned')), 'DD Mon YYYY') AS valid_till
           FROM students s JOIN schools sc ON sc.id = s.school_id LEFT JOIN files f ON f.id = s.photo_file_id AND f.deleted_at IS NULL
          WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [id],
      );
      const row = r.rows[0];
      if (!row) throw new Error(`student ${id} not found`);
      return {
        kind: 'student',
        school: {
          name: row.school,
          shortName: row.short_name,
          address: addressLine(row.address),
          phone: row.phone,
        },
        person: {
          name: row.name,
          code: row.admission_no,
          line1: row.klass ? `Class ${row.klass}` : null,
          line2: row.house ? `House ${row.house}` : null,
          dob: row.dob,
          bloodGroup: row.blood_group,
          contact: row.guardian,
        },
        validTill: row.valid_till ?? '',
        photoDataUri: await photoDataUri(storage, row.object_key, row.content_type),
      };
    });
  }
  if (rendererId === 'employee_id_card') {
    const id = String(params.employeeId ?? '');
    return db.withTenant(tenant, async (c) => {
      const r = await c.query<{
        name: string;
        employee_code: string;
        dob: string | null;
        designation: string | null;
        department: string | null;
        mobile: string | null;
        school: string;
        short_name: string | null;
        address: Record<string, string> | null;
        phone: string | null;
        object_key: string | null;
        content_type: string | null;
        valid_till: string;
      }>(
        `SELECT em.display_name AS name, em.employee_code, to_char(em.dob, 'DD Mon YYYY') AS dob, em.designation, em.department, em.mobile,
                sc.name AS school, sc.short_name, sc.address, sc.contact->>'phone' AS phone, f.object_key, f.content_type,
                to_char((SELECT max(y.end_date) FROM academic_years y WHERE y.status IN ('active','planned')), 'DD Mon YYYY') AS valid_till
           FROM employees em JOIN schools sc ON sc.id = em.school_id LEFT JOIN files f ON f.id = em.photo_file_id AND f.deleted_at IS NULL
          WHERE em.id = $1 AND em.deleted_at IS NULL`,
        [id],
      );
      const row = r.rows[0];
      if (!row) throw new Error(`employee ${id} not found`);
      return {
        kind: 'employee',
        school: {
          name: row.school,
          shortName: row.short_name,
          address: addressLine(row.address),
          phone: row.phone,
        },
        person: {
          name: row.name,
          code: row.employee_code,
          line1: row.designation,
          line2: row.department,
          dob: row.dob,
          bloodGroup: null,
          contact: row.mobile,
        },
        validTill: row.valid_till ?? '',
        photoDataUri: await photoDataUri(storage, row.object_key, row.content_type),
      };
    });
  }
  throw new Error(`unknown renderer ${rendererId}`);
}

function addressLine(a: Record<string, string> | null): string | null {
  if (!a) return null;
  return [a.line1, a.city, a.state, a.pincode].filter(Boolean).join(', ') || null;
}
