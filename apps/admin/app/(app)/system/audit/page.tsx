import { Alert, PageHeader } from '@edupro/ui';

export default function AuditPage() {
  return (
    <>
      <PageHeader
        kicker="System"
        title="Audit log"
        description="Every mutation and privileged action is recorded in an append-only log."
      />
      <Alert tone="info" title="Viewer arrives in Sprint 3">
        The audit query API and this viewer are backlog item S3-04. Rows are already being written:
        role grants, revocations, settings changes, year locks and file uploads all leave an entry.
      </Alert>
    </>
  );
}
