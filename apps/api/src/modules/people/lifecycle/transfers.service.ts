import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROFILE_FIELDS,
  ProfileWriteError,
  decryptField,
  encryptField,
  loadProfileLists,
  readStudentProfile,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  type PoolClient,
} from '@edupro/db';
import { LocalStorage } from '@edupro/storage';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { STORAGE_DRIVER, type StorageDriver } from '../../files/storage';

type Party = 'student' | 'father' | 'mother' | 'guardian';
interface FileRef {
  objectKey: string;
  contentType: string;
  name: string | null;
  size: number;
}
export interface TransferSnapshot {
  name: string;
  admissionNo: string;
  classSection: string | null;
  fromSchool: string;
  toSchool: string;
  values: Record<string, string | number>;
  /** ID numbers, encrypted at rest like the profile keeps them */
  secure: Record<string, string>;
  photos: Partial<Record<Party, FileRef>>;
  documents: Array<FileRef & { kind: string; title: string | null }>;
  logins: {
    student: string | null;
    father: string | null;
    mother: string | null;
    guardian: string | null;
  };
}

interface Row {
  id: string;
  from_school_id: string;
  to_school_id: string;
  from_student_id: string;
  withdrawal_id: string | null;
  status: 'requested' | 'accepted' | 'rejected' | 'cancelled';
  snapshot: TransferSnapshot;
  note: string | null;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  to_student_id: string | null;
}

const COLS = `id::text, from_school_id::text, to_school_id::text, from_student_id::text, withdrawal_id::text, status, snapshot, note,
  requested_by_name, requested_at, decided_by_name, decided_at, decision_note, to_student_id::text`;

/**
 * Transfer between schools of the group. Every school keeps its own records, so the student is copied:
 * the source school completes the withdrawal and sends the transfer (profile values with ID numbers
 * encrypted, photos, documents, logins); the target school accepts it into a class and section with a
 * new admission number. Values the target's masters do not know are left for its office to fill.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private view(r: Row, schoolId: string) {
    const s = r.snapshot;
    return {
      id: r.id,
      direction: r.from_school_id === schoolId ? ('outgoing' as const) : ('incoming' as const),
      status: r.status,
      withdrawalId: r.withdrawal_id,
      student: {
        id: r.from_student_id,
        name: s.name,
        admissionNo: s.admissionNo,
        classSection: s.classSection,
      },
      fromSchool: s.fromSchool,
      toSchool: s.toSchool,
      note: r.note,
      requestedBy: r.requested_by_name,
      requestedAt: r.requested_at.toISOString(),
      decidedBy: r.decided_by_name,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      toStudentId: r.to_student_id,
      carries: {
        photos: Object.keys(s.photos),
        documents: s.documents.length,
        parentLogins: [s.logins.father, s.logins.mother, s.logins.guardian].filter(Boolean).length,
        studentLogin: Boolean(s.logins.student),
      },
      // the target office sees what it is accepting (ID numbers stay masked)
      details:
        r.from_school_id === schoolId
          ? null
          : {
              gender: s.values.gender ?? null,
              dob: s.values.dob ?? null,
              fatherName: s.values.father_name ?? null,
              motherName: s.values.mother_name ?? null,
              mobile:
                s.values.sms_mobile ?? s.values.father_mobile ?? s.values.mother_mobile ?? null,
              address:
                [s.values.residential_address_line_1, s.values.residential_city]
                  .filter(Boolean)
                  .join(', ') || null,
            },
    };
  }

  async targets(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM app.transfer_targets()`,
      );
      return { data: r.rows };
    });
  }

  async list(ctx: RequestContext, box: 'incoming' | 'outgoing' | 'all' = 'all') {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- COLS is a constant; values are bound parameters
        `SELECT ${COLS} FROM school_transfers
          WHERE ($1 = 'all' OR ($1 = 'incoming' AND to_school_id = app.current_school_id()) OR ($1 = 'outgoing' AND from_school_id = app.current_school_id()))
          ORDER BY (status = 'requested') DESC, requested_at DESC LIMIT 500`,
        [box],
      );
      return { data: r.rows.map((x) => this.view(x, tenant.schoolId)) };
    });
  }

  private async find(c: PoolClient, id: string, lock = false): Promise<Row> {
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- COLS is a constant; values are bound parameters
      `SELECT ${COLS} FROM school_transfers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Transfer not found');
    return r.rows[0];
  }

  async get(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => this.view(await this.find(c, id), tenant.schoolId));
  }

  /** The source school sends a student whose withdrawal has cleared (dues settled) to another school. */
  async request(
    ctx: RequestContext,
    withdrawalId: string,
    dto: { toSchoolId: string; note?: string },
  ) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const w = await c.query<{ student_id: string; status: string }>(
        `SELECT student_id::text, status::text FROM student_withdrawals WHERE id = $1`,
        [withdrawalId],
      );
      if (!w.rows[0]) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['cleared', 'completed'].includes(w.rows[0].status))
        throw new DomainError(
          'transfer.not_cleared',
          'Send the transfer once every department has cleared the withdrawal',
          { status: 409 },
        );
      const target = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM app.transfer_targets() WHERE id = $1`,
        [dto.toSchoolId],
      );
      if (!target.rows[0])
        throw new DomainError('transfer.unknown_school', 'That school is not in this group', {
          status: 400,
        });
      const studentId = w.rows[0].student_id;
      const snapshot = await this.snapshot(c, studentId, target.rows[0].name);
      const me = await c.query<{ name: string | null }>(
        `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
      );
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO school_transfers (from_school_id, to_school_id, from_student_id, withdrawal_id, snapshot, note, requested_by, requested_by_name)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, app.current_user_id(), $6) RETURNING id::text`,
          [
            dto.toSchoolId,
            studentId,
            withdrawalId,
            JSON.stringify(snapshot),
            dto.note ?? null,
            me.rows[0]?.name ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'transfer.open_exists',
            'This student already has a transfer waiting',
            {
              status: 409,
            },
          );
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.transfer.request',
        entityType: 'school_transfers',
        entityId: id,
        after: { studentId, toSchoolId: dto.toSchoolId, withdrawalId },
      });
      return this.view(await this.find(c, id), tenant.schoolId);
    });
  }

  private async snapshot(
    c: PoolClient,
    studentId: string,
    toSchool: string,
  ): Promise<TransferSnapshot> {
    const snap = await readStudentProfile(c, studentId, { showSensitive: true });
    if (!snap) throw new DomainError('not-found', 'Student not found');
    const values: TransferSnapshot['values'] = {};
    const secure: TransferSnapshot['secure'] = {};
    for (const f of PROFILE_FIELDS) {
      if (f.store.t === 'auto' || f.store.t === 'enrol' || f.retired) continue;
      if (f.key === 'admission_no' || f.key === 'sibling_admission_no' || f.key === 'sibling_name')
        continue;
      const v = snap.values[f.key];
      if (v === null || v === undefined || v === '') continue;
      if (f.sensitive) secure[f.key] = encryptField(String(v));
      else values[f.key] = v as string | number;
    }
    const fileRef = async (fileId: string | undefined): Promise<FileRef | null> => {
      if (!fileId) return null;
      const r = await c.query<{
        object_key: string;
        content_type: string;
        original_name: string | null;
        size_bytes: string;
      }>(
        `SELECT object_key, content_type, original_name, size_bytes::text FROM files WHERE id = $1 AND status = 'ready'`,
        [fileId],
      );
      const x = r.rows[0];
      return x
        ? {
            objectKey: x.object_key,
            contentType: x.content_type,
            name: x.original_name,
            size: Number(x.size_bytes),
          }
        : null;
    };
    const photos: TransferSnapshot['photos'] = {};
    for (const p of ['student', 'father', 'mother', 'guardian'] as const) {
      const ref = await fileRef(snap.photos[p]);
      if (ref) photos[p] = ref;
    }
    const docs = await c.query<{
      kind: string;
      title: string | null;
      object_key: string;
      content_type: string;
      original_name: string | null;
      size_bytes: string;
    }>(
      `SELECT d.kind::text, d.title, f.object_key, f.content_type, f.original_name, f.size_bytes::text
         FROM person_documents d JOIN files f ON f.id = d.file_id AND f.status = 'ready'
        WHERE d.person_type = 'student' AND d.person_id = $1 AND d.deleted_at IS NULL AND d.kind::text <> 'photo'`,
      [studentId],
    );
    const people = await c.query<{ relation: string; user_id: string | null }>(
      `SELECT sg.relation::text, g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1`,
      [studentId],
    );
    const loginOf = (rel: 'father' | 'mother' | 'guardian') =>
      people.rows.find((x) =>
        rel === 'guardian' ? !['father', 'mother'].includes(x.relation) : x.relation === rel,
      )?.user_id ?? null;
    const st = await c.query<{ user_id: string | null; school: string }>(
      `SELECT s.user_id::text, sc.name AS school FROM students s JOIN schools sc ON sc.id = s.school_id WHERE s.id = $1`,
      [studentId],
    );
    return {
      name: snap.displayName,
      admissionNo: snap.admissionNo,
      classSection: snap.enrolment ? `${snap.enrolment.className} ${snap.enrolment.section}` : null,
      fromSchool: st.rows[0]?.school ?? '',
      toSchool,
      values,
      secure,
      photos,
      documents: docs.rows.map((d) => ({
        kind: d.kind,
        title: d.title,
        objectKey: d.object_key,
        contentType: d.content_type,
        name: d.original_name,
        size: Number(d.size_bytes),
      })),
      logins: {
        student: st.rows[0]?.user_id ?? null,
        father: loginOf('father'),
        mother: loginOf('mother'),
        guardian: loginOf('guardian'),
      },
    };
  }

  /** The target school accepts: a new student in the chosen section, with photos, documents and logins. */
  async accept(
    ctx: RequestContext,
    id: string,
    dto: { classSectionId: string; admissionNo: string; rollNo?: number },
  ) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const t = await this.find(c, id, true);
      if (t.to_school_id !== tenant.schoolId)
        throw new DomainError('not-found', 'Transfer not found');
      if (t.status !== 'requested')
        throw new DomainError('transfer.decided', 'This transfer was already decided', {
          status: 409,
        });
      const sec = await c.query<{ academic_year_id: string }>(
        `SELECT academic_year_id::text FROM class_sections WHERE id = $1 AND status = 'active'`,
        [dto.classSectionId],
      );
      if (!sec.rows[0])
        throw new DomainError('validation-failed', 'Choose a section of this school', {
          status: 400,
        });
      const dup = await c.query('SELECT 1 FROM students WHERE lower(admission_no) = lower($1)', [
        dto.admissionNo,
      ]);
      if (dup.rowCount)
        throw new DomainError(
          'people.admission_no.taken',
          `Another student has admission number ${dto.admissionNo}`,
          {
            status: 409,
          },
        );
      const s = t.snapshot;
      const raw: Record<string, unknown> = { ...s.values };
      for (const [k, v] of Object.entries(s.secure)) {
        const plain = decryptField(v);
        if (plain) raw[k] = plain;
      }
      // admitted here today; the earlier school and admission number go in as the previous school
      raw.admitted_on = new Date().toISOString().slice(0, 10);
      raw.previous_school_name = s.fromSchool;
      const lists = await loadProfileLists(c);
      const { values, errors } = validateChanges(raw, lists);
      const notCarried = Object.keys(errors);
      if (!values.first_name)
        throw new DomainError('validation-failed', 'The transfer has no first name', {
          status: 400,
        });
      const ins = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, gender, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, 'unspecified', app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [dto.admissionNo.trim(), values.first_name],
      );
      const studentId = ins.rows[0]!.id;
      // write what the target accepts; a value it refuses (a taken registration no) is left for its office
      let toWrite = { ...values };
      for (let round = 0; round < 3; round += 1) {
        try {
          await c.query('SAVEPOINT transfer_profile');
          await writeStudentProfile(c, studentId, toWrite);
          await c.query('RELEASE SAVEPOINT transfer_profile');
          break;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT transfer_profile');
          if (!(error instanceof ProfileWriteError) || round === 2) throw error;
          for (const k of Object.keys(error.errors)) {
            delete toWrite[k];
            notCarried.push(k);
          }
          toWrite = { ...toWrite };
        }
      }
      const roll =
        dto.rollNo ??
        (
          await c.query<{ n: number }>(
            `SELECT COALESCE(max(roll_no), 0)::int + 1 AS n FROM enrolments WHERE class_section_id = $1 AND status = 'active'`,
            [dto.classSectionId],
          )
        ).rows[0]!.n;
      await c.query(`SELECT app.enrol_student($1, $2, $3, $4, CURRENT_DATE)`, [
        studentId,
        sec.rows[0].academic_year_id,
        dto.classSectionId,
        roll,
      ]);
      // photos and documents: the bytes are copied into this school's storage
      const copy = async (ref: FileRef): Promise<string> => {
        const bytes = await this.storage.read(ref.objectKey);
        const ext = ref.objectKey.split('.').pop() ?? 'bin';
        const key = LocalStorage.joinKey(
          `school-${tenant.schoolId}`,
          String(new Date().getUTCFullYear()),
          String(new Date().getUTCMonth() + 1).padStart(2, '0'),
          `${randomUUID()}.${ext}`,
        );
        await this.storage.write(key, bytes, ref.contentType);
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, classification, storage_driver, status, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'personal', $6, 'ready', app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [this.storage.bucket, key, ref.contentType, bytes.length, ref.name, this.storage.name],
        );
        return f.rows[0]!.id;
      };
      if (s.photos.student) {
        const fileId = await copy(s.photos.student);
        await c.query('UPDATE students SET photo_file_id = $2 WHERE id = $1', [studentId, fileId]);
      }
      const guardians = await c.query<{ id: string; relation: string }>(
        `SELECT g.id::text, sg.relation::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1`,
        [studentId],
      );
      const guardianOf = (p: 'father' | 'mother' | 'guardian') =>
        guardians.rows.find((x) =>
          p === 'guardian' ? !['father', 'mother'].includes(x.relation) : x.relation === p,
        )?.id;
      for (const p of ['father', 'mother', 'guardian'] as const) {
        const ref = s.photos[p];
        const gid = guardianOf(p);
        if (ref && gid) {
          const fileId = await copy(ref);
          await c.query('UPDATE guardians SET photo_file_id = $2 WHERE id = $1', [gid, fileId]);
        }
      }
      for (const d of s.documents) {
        const fileId = await copy(d);
        await c.query(
          `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, created_by)
           VALUES (app.current_school_id(), 'student', $1, $2::document_kind, $3, $4, app.current_user_id())`,
          [studentId, d.kind, fileId, d.title ?? 'Carried over by school transfer'],
        );
      }
      // logins: the parents and the student keep their own login, now also for this school
      const link = async (userId: string | null, personType: 'guardian' | 'student') => {
        if (!userId) return;
        await c.query(
          `INSERT INTO user_school_memberships (school_id, user_id, person_type)
           SELECT app.current_school_id(), $1, $2::person_type
            WHERE NOT EXISTS (SELECT 1 FROM user_school_memberships WHERE school_id = app.current_school_id() AND user_id = $1 AND person_type = $2::person_type)`,
          [userId, personType],
        );
        await c.query(
          `UPDATE user_school_memberships SET status = 'active' WHERE school_id = app.current_school_id() AND user_id = $1 AND person_type = $2::person_type`,
          [userId, personType],
        );
      };
      for (const p of ['father', 'mother', 'guardian'] as const) {
        const userId = s.logins[p];
        const gid = guardianOf(p);
        if (userId && gid) {
          await c.query('UPDATE guardians SET user_id = $2 WHERE id = $1 AND user_id IS NULL', [
            gid,
            userId,
          ]);
          await link(userId, 'guardian');
        }
      }
      if (s.logins.student) {
        await c.query('UPDATE students SET user_id = $2 WHERE id = $1', [
          studentId,
          s.logins.student,
        ]);
        await link(s.logins.student, 'student');
      }
      await refreshCompleteness(c, studentId);
      const me = await c.query<{ name: string | null }>(
        `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
      );
      await c.query(
        `UPDATE school_transfers SET status = 'accepted', decided_by = app.current_user_id(), decided_by_name = $2, decided_at = now(),
                to_student_id = $3, to_class_section_id = $4 WHERE id = $1`,
        [id, me.rows[0]?.name ?? null, studentId, dto.classSectionId],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.transfer.accept',
        entityType: 'school_transfers',
        entityId: id,
        after: {
          studentId,
          admissionNo: dto.admissionNo,
          classSectionId: dto.classSectionId,
          notCarried,
          documents: s.documents.length,
        },
      });
      return {
        ...this.view(await this.find(c, id), tenant.schoolId),
        notCarried: [...new Set(notCarried)],
      };
    });
  }

  /** The target refuses, or the source withdraws the transfer, with a reason. */
  async close(ctx: RequestContext, id: string, how: 'rejected' | 'cancelled', reason: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const t = await this.find(c, id, true);
      const mine = how === 'rejected' ? t.to_school_id : t.from_school_id;
      if (mine !== tenant.schoolId) throw new DomainError('not-found', 'Transfer not found');
      if (t.status !== 'requested')
        throw new DomainError('transfer.decided', 'This transfer was already decided', {
          status: 409,
        });
      const me = await c.query<{ name: string | null }>(
        `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
      );
      await c.query(
        `UPDATE school_transfers SET status = $2, decided_by = app.current_user_id(), decided_by_name = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [id, how, me.rows[0]?.name ?? null, reason],
      );
      await this.audit.stage(ctx, c, {
        action: how === 'rejected' ? 'people.transfer.reject' : 'people.transfer.cancel',
        entityType: 'school_transfers',
        entityId: id,
        after: { reason },
      });
      return this.view(await this.find(c, id), tenant.schoolId);
    });
  }
}
