-- 0057: the hypercare screens and digest read the ERP provider desk (merged in 0056) through this view.
CREATE VIEW provider_issues WITH (security_invoker = true) AS
SELECT q.id, q.school_id, q.number, q.subject AS title, q.body AS detail, COALESCE(q.module, 'other') AS module,
       CASE q.priority WHEN 'urgent' THEN 's1' WHEN 'high' THEN 's2' WHEN 'normal' THEN 's3' ELSE 's4' END AS severity,
       COALESCE(q.channel, 'admin') AS channel, COALESCE(q.provider_status, 'open') AS status,
       q.raised_by_user_id AS reporter_user, q.assigned_role, q.assigned_user_id AS assigned_user,
       q.due_at, q.workaround, q.resolution, q.first_response_at, q.closed_at, q.opened_at AS created_at, q.updated_at
  FROM parent_queries q
 WHERE q.desk = 'provider';
GRANT SELECT ON provider_issues TO PUBLIC;
