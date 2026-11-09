-- Who approves a physical count and a rate correction (docs/design/84, "As built — count approval on Who
-- approves; the store page in tabs", 9 Nov 2026): levels per department on Purchase → Who approves (the
-- store's department; a store without one goes by the purchase office's department), run by the workflow
-- engine; none set — the school admin, as before.
ALTER TABLE purchase_department_approvals DROP CONSTRAINT purchase_department_approvals_doc_type_check;
ALTER TABLE purchase_department_approvals ADD CONSTRAINT purchase_department_approvals_doc_type_check
  CHECK (doc_type IN ('indent', 'requisition', 'order', 'inspection', 'count', 'revaluation'));

ALTER TABLE stock_counts ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
ALTER TABLE stock_revaluations ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
