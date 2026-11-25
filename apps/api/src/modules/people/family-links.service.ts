import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  FAMILY_RELATIONS,
  familyChild,
  familyRows,
  namedSibling,
  type FamilyRelation,
} from './family-links';
import type { FamilyLinkDto } from './people.dto';
import { StudentsService } from './students.service';

/**
 * Link families (0426, docs/design/89 "Sibling families"): a student's Sibling section is information only, so two
 * siblings can hang off different father and mother records and a parent's login sees one of them. The office keeps
 * one record per relation for both (or leaves them apart); the other child's link moves to it. Undo puts it back.
 */
@Injectable()
export class FamilyLinksService {
  constructor(
    private readonly db: DbService,
    private readonly students: StudentsService,
    private readonly audit: AuditService,
  ) {}

  /** A class teacher reaches only the students of their sections (as the student's page). */
  private async assertVisible(ctx: RequestContext, c: PoolClient, id: string) {
    const allowed = await this.students.scopeFilter(requireTenant(ctx));
    if (allowed === null) return;
    const r = await c.query(
      `SELECT 1 FROM enrolments WHERE student_id = $1 AND class_section_id = ANY($2::bigint[]) AND status = 'active'`,
      [id, allowed],
    );
    if ((r.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Student not found');
  }

  /** Both children and, for the father and the mother, each child's record and what to keep. */
  async preview(ctx: RequestContext, studentId: string, siblingAdmissionNo?: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.assertVisible(ctx, c, studentId);
      const student = await familyChild(c, studentId);
      if (!student) throw new DomainError('not-found', 'Student not found');
      const sibling = siblingAdmissionNo
        ? await c
            .query<{ id: string }>(
              'SELECT id::text FROM students WHERE lower(admission_no) = lower($1) AND deleted_at IS NULL',
              [siblingAdmissionNo],
            )
            .then((r) => (r.rows[0] ? familyChild(c, r.rows[0].id) : null))
        : await namedSibling(c, studentId);
      if (!sibling)
        throw new DomainError(
          'family.no_sibling',
          'No sibling on record: enter the sibling admission number in the Sibling section first',
          { status: 404 },
        );
      if (sibling.id === student.id)
        throw new DomainError('family.same_student', 'A student is not their own sibling', {
          status: 400,
        });
      return { student, sibling, relations: await familyRows(c, studentId, sibling.id) };
    });
  }

  /** Link the families as chosen: for each relation keep this child's record, the sibling's, or leave them apart. */
  async link(ctx: RequestContext, studentId: string, dto: FamilyLinkDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.assertVisible(ctx, c, studentId);
      await this.assertVisible(ctx, c, dto.siblingId);
      const student = await familyChild(c, studentId);
      const sibling = await familyChild(c, dto.siblingId);
      if (!student || !sibling) throw new DomainError('not-found', 'Student not found');
      if (student.id === sibling.id)
        throw new DomainError('family.same_student', 'A student is not their own sibling', {
          status: 400,
        });
      const rows = await familyRows(c, student.id, sibling.id);
      const batchId = randomUUID();
      const moves: Array<{
        relation: FamilyRelation;
        moved: string;
        from: string | null;
        to: string;
      }> = [];
      for (const relation of FAMILY_RELATIONS) {
        const choice = dto.keep[relation] ?? 'apart';
        const row = rows.find((r) => r.relation === relation)!;
        if (choice === 'apart' || row.state === 'shared' || row.state === 'none') continue;
        const kept = choice === 'here' ? row.here : row.sibling;
        const old = choice === 'here' ? row.sibling : row.here;
        if (!kept)
          throw new DomainError(
            'family.no_record',
            `There is no ${relation}'s record to keep on that side`,
            { status: 400 },
          );
        const moved = choice === 'here' ? sibling.id : student.id;
        // the moved child is linked to the kept record already (in another relation): nothing to move
        const linked = await c.query(
          'SELECT 1 FROM student_guardians WHERE student_id = $1 AND guardian_id = $2',
          [moved, kept.guardianId],
        );
        if ((linked.rowCount ?? 0) > 0) continue;
        if (old)
          await c.query(
            'DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2',
            [moved, old.guardianId],
          );
        await c.query(
          `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, receives_notifications, created_by)
           VALUES (app.current_school_id(), $1, $2, $3::guardian_relation, $4, $5, app.current_user_id())`,
          [
            moved,
            kept.guardianId,
            relation,
            old?.isPrimary ?? false,
            old?.receivesNotifications ?? true,
          ],
        );
        await c.query(
          `INSERT INTO family_links (school_id, batch_id, student_id, sibling_id, relation, moved_student, guardian_from,
                                     guardian_to, was_primary, was_notified, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::guardian_relation, $5, $6, $7, $8, $9, app.current_user_id())`,
          [
            batchId,
            student.id,
            sibling.id,
            relation,
            moved,
            old?.guardianId ?? null,
            kept.guardianId,
            old?.isPrimary ?? false,
            old?.receivesNotifications ?? true,
          ],
        );
        moves.push({ relation, moved, from: old?.guardianId ?? null, to: kept.guardianId });
      }
      if (moves.length)
        await this.audit.stage(ctx, c, {
          action: 'people.family.link',
          entityType: 'students',
          entityId: student.id,
          after: { sibling: sibling.id, batchId, moves },
        });
      return { batchId: moves.length ? batchId : null, moved: moves.length };
    });
  }

  /** Undo a Link families: each moved child back on its own record (as it was linked). */
  async undo(ctx: RequestContext, studentId: string, batchId: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.assertVisible(ctx, c, studentId);
      const r = await c.query<{
        id: string;
        relation: string;
        moved_student: string;
        guardian_from: string | null;
        guardian_to: string;
        was_primary: boolean;
        was_notified: boolean;
      }>(
        `SELECT id::text, relation::text, moved_student::text, guardian_from::text, guardian_to::text, was_primary, was_notified
           FROM family_links
          WHERE batch_id = $1::uuid AND (student_id = $2 OR sibling_id = $2) AND undone_at IS NULL
          ORDER BY id DESC`,
        [batchId, studentId],
      );
      if (!r.rows.length)
        throw new DomainError('family.no_link', 'Nothing to undo for this student', {
          status: 404,
        });
      for (const x of r.rows) {
        await c.query('DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2', [
          x.moved_student,
          x.guardian_to,
        ]);
        if (x.guardian_from)
          await c.query(
            `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, receives_notifications, created_by)
             SELECT app.current_school_id(), $1, $2, $3::guardian_relation, $4, $5, app.current_user_id()
              WHERE EXISTS (SELECT 1 FROM guardians WHERE id = $2 AND deleted_at IS NULL)
             ON CONFLICT (student_id, guardian_id) DO NOTHING`,
            [x.moved_student, x.guardian_from, x.relation, x.was_primary, x.was_notified],
          );
        await c.query(
          'UPDATE family_links SET undone_at = now(), undone_by = app.current_user_id() WHERE id = $1',
          [x.id],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'people.family.link_undo',
        entityType: 'students',
        entityId: studentId,
        after: { batchId, moves: r.rows.length },
      });
      return { undone: r.rows.length };
    });
  }
}
