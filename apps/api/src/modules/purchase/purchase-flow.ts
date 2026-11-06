import type { PoolClient } from '@edupro/db';
import type { Resolver } from '../workflow/workflow.dto';
import type { Level } from '../workflow/workflow.service';

export type PurchaseDocType = 'indent' | 'requisition' | 'order' | 'inspection';

interface SetupLevel {
  name: string;
  by: 'employees' | 'designation' | 'hod';
  employeeIds: string[];
  designation: string | null;
  slaHours: number | null;
}

const resolverOf = (l: SetupLevel): Resolver => ({
  kind: 'staff',
  by: l.by,
  employeeIds: l.by === 'employees' ? l.employeeIds : [],
  ...(l.by === 'designation' && l.designation ? { designation: l.designation } : {}),
});

/** The workflow definition of a department's PIs (PRs, POs): `purchase_indent_<department id>`. */
export const flowCode = (doc: PurchaseDocType, departmentId: string) =>
  `purchase_${doc}_${departmentId}`;

/**
 * Keeps the department's workflow definition equal to its levels on Purchase → Who approves
 * (docs/design/83): each level re-planned as the document moves (a level nobody holds is skipped, one
 * already approved by the same person counts), nobody approves their own (their level passes on, the
 * last to the school admin), and an overdue level escalates to the next one's people (the last to the
 * school admin). Returns the code and how many levels the department has.
 */
export async function syncFlow(
  c: PoolClient,
  doc: PurchaseDocType,
  departmentId: string,
): Promise<{ code: string; levels: number; department: string }> {
  const r = await c.query<{ name: string; levels: SetupLevel[] | null; hod_signs_in: boolean }>(
    `SELECT d.name, a.levels,
            EXISTS (SELECT 1 FROM employees h WHERE h.id = d.hod_employee_id AND h.user_id IS NOT NULL
                       AND h.status = 'active' AND h.deleted_at IS NULL) AS hod_signs_in
       FROM departments d
       LEFT JOIN purchase_department_approvals a ON a.department_id = d.id AND a.doc_type = $2
      WHERE d.id = $1`,
    [departmentId, doc],
  );
  const dep = r.rows[0];
  let setup = dep?.levels ?? [];
  // receipts are inspected by the department's HOD when nothing else is set (the school admin when the
  // department has no HOD who signs in)
  const adminOnly = doc === 'inspection' && !setup.length && !dep?.hod_signs_in;
  if (doc === 'inspection' && !setup.length && !adminOnly)
    setup = [
      { name: 'Head of department', by: 'hod', employeeIds: [], designation: null, slaHours: null },
    ];
  const levels: Level[] = adminOnly
    ? [
        {
          level: 1,
          name: 'School admin (no HOD set)',
          resolver: { kind: 'role', roleCode: 'school_admin' },
          autoSkip: true,
          noSelfApproval: true,
        },
      ]
    : setup.map((l, i) => ({
        level: i + 1,
        name: l.name,
        resolver: resolverOf(l),
        ...(l.slaHours ? { slaHours: l.slaHours } : {}),
        escalateTo:
          i + 1 < setup.length
            ? resolverOf(setup[i + 1]!)
            : { kind: 'role', roleCode: 'school_admin' },
        autoSkip: true,
        noSelfApproval: true,
      }));
  const code = flowCode(doc, departmentId);
  const title = {
    indent: 'Purchase Indent',
    requisition: 'Purchase Requisition',
    order: 'Purchase Order',
    inspection: 'Inspection of receipts',
  }[doc];
  const name = `${title} · ${dep?.name ?? departmentId}`;
  const upd = await c.query(
    `UPDATE workflow_definitions SET name = $2, levels = $3::jsonb, creator_roles = '{}', status = 'active', updated_at = now(),
            updated_by = app.current_user_id()
      WHERE code = $1 AND deleted_at IS NULL`,
    [code, name, JSON.stringify(levels)],
  );
  if (!upd.rowCount)
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, '{}', app.current_user_id(), app.current_user_id())`,
      [code, name, `purchase_${doc}`, JSON.stringify(levels)],
    );
  return { code, levels: levels.length, department: dep?.name ?? '' };
}
