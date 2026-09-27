'use client';
import { DataGrid } from '@edupro/ui';
import type { AuditRow } from '@/lib/types';

function summariseDiff(diff: AuditRow['diff']): string {
  if (!diff) return '';
  return Object.entries(diff)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${short(v.from)} → ${short(v.to)}`)
    .join('; ');
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

/** Client grid for the audit viewer (S3-07): sorting, filtering and column choice happen in the browser. */
export function AuditGrid({ rows }: { rows: AuditRow[] }) {
  return (
    <DataGrid<AuditRow>
      id="audit"
      caption="Audit log"
      rows={rows}
      rowKey={(r) => r.id}
      pageSize={25}
      density="dense"
      columns={[
        {
          key: 'occurredAt',
          header: 'When',
          render: (r) => new Date(r.occurredAt).toLocaleString('en-IN'),
        },
        {
          key: 'actorName',
          header: 'Actor',
          accessor: (r) => r.actorName ?? r.actorType,
          render: (r) => r.actorName ?? r.actorType,
        },
        { key: 'action', header: 'Action', render: (r) => <code>{r.action}</code> },
        { key: 'entityType', header: 'Entity' },
        { key: 'entityId', header: 'Id', render: (r) => r.entityId ?? '' },
        {
          key: 'diff',
          header: 'Changes',
          accessor: (r) => summariseDiff(r.diff),
          render: (r) => (
            <span title={r.diff ? JSON.stringify(r.diff) : ''}>{summariseDiff(r.diff)}</span>
          ),
        },
        {
          key: 'permissionCode',
          header: 'Permission',
          hidden: true,
          render: (r) => r.permissionCode ?? '',
        },
        { key: 'requestId', header: 'Request', hidden: true, render: (r) => r.requestId ?? '' },
        { key: 'ip', header: 'IP', hidden: true, render: (r) => r.ip ?? '' },
        { key: 'source', header: 'Source', hidden: true },
      ]}
      emptyTitle="No audit entries match"
    />
  );
}
