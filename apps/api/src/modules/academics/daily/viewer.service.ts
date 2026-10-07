import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { FilesService } from '../../files/files.service';
import { AcademicSettingsService, type UploadSection } from './academic-settings.service';

export interface Viewer {
  /** Staff read through class_section scopes (null = unrestricted); families read their children only. */
  kind: 'staff' | 'family';
  sectionIds: string[] | null;
  /** Children of a guardian, or the student themself. Empty for staff. */
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
  employeeId: string | null;
}

/**
 * Who is looking (S7): the same list endpoints serve administrators, scoped teachers and families.
 * A user with an employee record is staff and follows ADR-004 scopes; otherwise the rows are limited
 * to the sections of the students linked to the user (guardians.user_id or students.user_id).
 */
@Injectable()
export class ViewerService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly files: FilesService,
    private readonly settings: AcademicSettingsService,
  ) {}

  requireYear(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async resolve(ctx: RequestContext, permission: string): Promise<Viewer> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const emp = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      // Staff membership (employees, administrators, support) reads through ADR-004 scopes even without
      // an employee record; guardians and students are families.
      const membership = await c.query<{ person_type: string }>(
        `SELECT person_type::text FROM user_school_memberships
          WHERE user_id = app.current_user_id() AND school_id = app.current_school_id() AND status = 'active' AND deleted_at IS NULL
          ORDER BY CASE person_type WHEN 'employee' THEN 0 WHEN 'external' THEN 1 ELSE 2 END LIMIT 1`,
      );
      const staff =
        emp.rows[0] !== undefined ||
        ['employee', 'external'].includes(membership.rows[0]?.person_type ?? '');
      if (staff) {
        const allowed = await this.scopes.filter(tenant, permission, 'class_section');
        return {
          kind: 'staff',
          sectionIds: allowed,
          students: [],
          employeeId: emp.rows[0]?.id ?? null,
        };
      }
      const kids = await c.query<{
        id: string;
        name: string;
        class_section_id: string | null;
        section: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, e.class_section_id::text, c.code || '-' || cs.name AS section
           FROM students s
           LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active'
           LEFT JOIN class_sections cs ON cs.id = e.class_section_id
           LEFT JOIN classes c ON c.id = cs.class_id
          WHERE s.deleted_at IS NULL AND (
                s.user_id = app.current_user_id()
             OR s.id IN (SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                          WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL))
          ORDER BY s.display_name`,
        [yearId],
      );
      const students = kids.rows.map((k) => ({
        id: k.id,
        name: k.name,
        classSectionId: k.class_section_id,
        section: k.section,
      }));
      return {
        kind: 'family',
        sectionIds: students.map((s) => s.classSectionId).filter((x): x is string => x !== null),
        students,
        employeeId: null,
      };
    });
  }

  /**
   * Attachments must be uploaded, ready and visible to the tenant (row-level security), and no larger
   * than the school allows in that academics section.
   */
  async assertFilesReady(
    ctx: RequestContext,
    fileIds: string[],
    section?: UploadSection,
  ): Promise<void> {
    const seen: Array<{ name: string | null; sizeBytes: number }> = [];
    for (const id of new Set(fileIds)) {
      const file = await this.files.get(ctx, id);
      if (file.status !== 'ready')
        throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
          status: 409,
          extra: { fileId: id },
        });
      seen.push({ name: file.fileName, sizeBytes: file.sizeBytes });
    }
    if (section) await this.settings.assertSize(ctx, section, seen);
  }
}
