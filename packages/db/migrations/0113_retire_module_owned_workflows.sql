-- 0113: three kinds of request no longer ride the approval engine: gate passes keep their own levels
-- (0069, gate pass set-up), transport requests too (0077, transport settings), and appointments are
-- decided by the front desk (0059, appointment set-up). Their old definitions are no longer listed under
-- Approval set-up. Switch them off for good and close what still waited on them, so nobody is asked to
-- approve a request the module no longer reads.
UPDATE workflow_steps s SET status = 'skipped'
  FROM workflow_instances i JOIN workflow_definitions d ON d.id = i.definition_id
 WHERE s.instance_id = i.id AND s.status = 'pending' AND i.status = 'pending'
   AND d.code IN ('gate_pass', 'appointment_request', 'transport_request');

UPDATE workflow_instances i SET status = 'cancelled', completed_at = now(), updated_at = now()
  FROM workflow_definitions d
 WHERE d.id = i.definition_id AND i.status = 'pending'
   AND d.code IN ('gate_pass', 'appointment_request', 'transport_request');

UPDATE workflow_definitions SET status = 'inactive', updated_at = now()
 WHERE code IN ('gate_pass', 'appointment_request', 'transport_request') AND status = 'active';
