/** The two views of "Who approves": each employee with their approvers (first), and the group rules. */
export function ApprovalsTabs({ current }: { current: 'employees' | 'rules' }) {
  return (
    <div className="ep-tabs">
      <div role="tablist" aria-label="Who approves" className="ep-tabs__list">
        <a
          role="tab"
          aria-selected={current === 'employees'}
          className="ep-tabs__tab"
          href="/leave/setup/approvals"
        >
          Each employee
        </a>
        <a
          role="tab"
          aria-selected={current === 'rules'}
          className="ep-tabs__tab"
          href="/leave/setup/approvals/rules"
        >
          Group rules
        </a>
      </div>
    </div>
  );
}
