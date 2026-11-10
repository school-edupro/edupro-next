/** The two views of "Who approves": the rules, and each employee with the approvers they have. */
export function ApprovalsTabs({ current }: { current: 'rules' | 'employees' }) {
  return (
    <div className="ep-tabs">
      <div role="tablist" aria-label="Who approves" className="ep-tabs__list">
        <a
          role="tab"
          aria-selected={current === 'rules'}
          className="ep-tabs__tab"
          href="/leave/setup/approvals"
        >
          Rules
        </a>
        <a
          role="tab"
          aria-selected={current === 'employees'}
          className="ep-tabs__tab"
          href="/leave/setup/approvals/by-employee"
        >
          By employee
        </a>
      </div>
    </div>
  );
}
