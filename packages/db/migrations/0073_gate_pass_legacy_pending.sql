-- Passes asked before gate pass v2 (0069) and still pending have no approval rows, so nobody could act on
-- them: they wait on the school admins, who approve or reject them under "To approve".
INSERT INTO gate_pass_approvals (school_id, pass_id, seq, label, approver_user_ids, status)
SELECT p.school_id, p.id, 1, 'School admin',
       COALESCE((SELECT array_agg(DISTINCT ur.user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.school_id = p.school_id AND r.code = 'school_admin' AND ur.revoked_at IS NULL), '{}'),
       'pending'
  FROM gate_passes p
 WHERE p.state = 'pending' AND NOT EXISTS (SELECT 1 FROM gate_pass_approvals a WHERE a.pass_id = p.id);
