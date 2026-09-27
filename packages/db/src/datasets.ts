/**
 * Export datasets (S3-03). The API validates the request (dataset exists, caller holds the permission,
 * scope filters applied) and the worker runs the query under the requester's tenant context, so
 * row-level security and the scope filter both apply to the generated file.
 *
 * Every query uses bound parameters only; params arrive as JSON from the exports row.
 */
export type DatasetColumnType = 'text' | 'number' | 'date' | 'datetime' | 'json';

export interface DatasetColumn {
  key: string;
  header: string;
  type?: DatasetColumnType;
  width?: number;
}

export interface DatasetQuery {
  text: string;
  values: unknown[];
}

export interface DatasetDefinition {
  id: string;
  title: string;
  /** Permission the requester must hold. */
  permission: string;
  /** Scope type the API resolves into params.sectionIds when the requester is scoped. */
  scope?: 'class_section';
  columns: DatasetColumn[];
  maxRows: number;
  query: (params: Record<string, unknown>) => DatasetQuery;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const idList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 ? v.map(String) : null;

export const DATASETS: Record<string, DatasetDefinition> = {
  classes: {
    id: 'classes',
    title: 'Classes',
    permission: 'academics.class.view',
    maxRows: 10_000,
    columns: [
      { key: 'code', header: 'Code', width: 12 },
      { key: 'name', header: 'Name', width: 28 },
      { key: 'display_order', header: 'Order', type: 'number', width: 8 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'updated_at', header: 'Updated', type: 'datetime', width: 20 },
    ],
    query: () => ({
      text: 'SELECT code, name, display_order, status::text, updated_at FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code',
      values: [],
    }),
  },
  class_sections: {
    id: 'class_sections',
    title: 'Sections',
    permission: 'academics.class_section.view',
    scope: 'class_section',
    maxRows: 20_000,
    columns: [
      { key: 'academic_year', header: 'Year', width: 10 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'class_name', header: 'Class name', width: 24 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'capacity', header: 'Capacity', type: 'number', width: 10 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    query: (p) => ({
      text: `SELECT y.code AS academic_year, c.code AS class_code, c.name AS class_name, s.name AS section, s.capacity, s.status::text
               FROM class_sections s
               JOIN classes c ON c.id = s.class_id
               JOIN academic_years y ON y.id = s.academic_year_id
              WHERE s.deleted_at IS NULL
                AND ($1::bigint IS NULL OR s.academic_year_id = $1::bigint)
                AND ($2::bigint[] IS NULL OR s.id = ANY($2::bigint[]))
              ORDER BY y.start_date DESC, c.display_order, s.name`,
      values: [str(p.academicYearId), idList(p.sectionIds)],
    }),
  },
  members: {
    id: 'members',
    title: 'Members',
    permission: 'access.assignment.view',
    maxRows: 50_000,
    columns: [
      { key: 'display_name', header: 'Name', width: 28 },
      { key: 'person_type', header: 'Type', width: 12 },
      { key: 'mobile', header: 'Mobile', width: 14 },
      { key: 'email', header: 'Email', width: 28 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'roles', header: 'Roles', width: 40 },
      { key: 'last_login_at', header: 'Last sign-in', type: 'datetime', width: 20 },
    ],
    query: (p) => ({
      text: `SELECT u.display_name, m.person_type::text, u.mobile, u.email, m.status::text,
                    (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND ur.revoked_at IS NULL) AS roles,
                    u.last_login_at
               FROM user_school_memberships m
               JOIN users u ON u.id = m.user_id
              WHERE m.deleted_at IS NULL
                AND ($1::person_type IS NULL OR m.person_type = $1::person_type)
              ORDER BY u.display_name`,
      values: [str(p.personType)],
    }),
  },
  assignments: {
    id: 'assignments',
    title: 'Role assignments',
    permission: 'access.assignment.view',
    maxRows: 50_000,
    columns: [
      { key: 'display_name', header: 'Person', width: 28 },
      { key: 'role', header: 'Role', width: 24 },
      { key: 'campus', header: 'Campus', width: 16 },
      { key: 'valid_from', header: 'Valid from', type: 'date', width: 12 },
      { key: 'valid_to', header: 'Valid to', type: 'date', width: 12 },
      { key: 'revoked_at', header: 'Revoked', type: 'datetime', width: 20 },
      { key: 'reason', header: 'Reason', width: 40 },
    ],
    query: (p) => ({
      text: `SELECT u.display_name, r.name AS role, c.name AS campus, ur.valid_from, ur.valid_to, ur.revoked_at, ur.reason
               FROM user_roles ur
               JOIN users u ON u.id = ur.user_id
               JOIN roles r ON r.id = ur.role_id
               LEFT JOIN campuses c ON c.id = ur.campus_id
              WHERE ($1::boolean IS NULL OR ($1::boolean = (ur.revoked_at IS NULL)))
              ORDER BY u.display_name, r.name`,
      values: [typeof p.active === 'boolean' ? p.active : null],
    }),
  },
  audit_logs: {
    id: 'audit_logs',
    title: 'Audit log',
    permission: 'platform.audit.view',
    maxRows: 100_000,
    columns: [
      { key: 'occurred_at', header: 'When', type: 'datetime', width: 20 },
      { key: 'actor', header: 'Actor', width: 24 },
      { key: 'action', header: 'Action', width: 28 },
      { key: 'entity_type', header: 'Entity', width: 20 },
      { key: 'entity_id', header: 'Entity id', width: 12 },
      { key: 'permission_code', header: 'Permission', width: 28 },
      { key: 'request_id', header: 'Request', width: 38 },
      { key: 'diff', header: 'Changes', type: 'json', width: 60 },
    ],
    query: (p) => ({
      text: `SELECT a.occurred_at, COALESCE(u.display_name, a.actor_type::text) AS actor, a.action, a.entity_type, a.entity_id,
                    a.permission_code, a.request_id::text, a.diff
               FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_user_id
              WHERE ($1::timestamptz IS NULL OR a.occurred_at >= $1::timestamptz)
                AND ($2::timestamptz IS NULL OR a.occurred_at < $2::timestamptz)
                AND ($3::text IS NULL OR a.entity_type = $3::text)
                AND ($4::text IS NULL OR a.entity_id = $4::text)
                AND ($5::bigint IS NULL OR a.actor_user_id = $5::bigint)
                AND ($6::text IS NULL OR a.action LIKE $6::text || '%')
              ORDER BY a.occurred_at DESC`,
      values: [
        str(p.from),
        str(p.to),
        str(p.entityType),
        str(p.entityId),
        str(p.actorUserId),
        str(p.action),
      ],
    }),
  },
};

export const DATASET_IDS = Object.keys(DATASETS) as [string, ...string[]];

export function datasetOrNull(id: string): DatasetDefinition | null {
  return Object.prototype.hasOwnProperty.call(DATASETS, id) ? DATASETS[id]! : null;
}
