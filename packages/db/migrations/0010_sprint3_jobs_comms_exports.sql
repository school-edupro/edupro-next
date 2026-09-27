-- 0010_sprint3_jobs_comms_exports.sql
-- Sprint 3: outbox claiming for the publisher, notification templates and delivery log, export jobs,
-- and the permissions those APIs declare.

-- ---------------------------------------------------------------------------
-- Outbox: the publisher claims batches across every school. jobs_outbox is tenant data under RLS, so the
-- three routines below are SECURITY DEFINER with a narrow surface (ADR-006 exception, recorded here with
-- app.invite_user). A claim is a lease: rows come back to 'pending' when the lease expires unpublished.
-- ---------------------------------------------------------------------------
ALTER TABLE jobs_outbox ADD COLUMN locked_until TIMESTAMPTZ;
ALTER TABLE jobs_outbox ADD COLUMN request_id UUID;
ALTER TABLE jobs_outbox ADD COLUMN created_by BIGINT;
CREATE INDEX jobs_outbox_failed ON jobs_outbox (school_id, created_at DESC) WHERE status = 'failed';

CREATE OR REPLACE FUNCTION app.claim_outbox_batch(p_limit INT DEFAULT 100, p_lock_seconds INT DEFAULT 60)
RETURNS SETOF jobs_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM jobs_outbox o
     WHERE o.status = 'pending' AND o.available_at <= now()
       AND (o.locked_until IS NULL OR o.locked_until < now())
     ORDER BY o.available_at, o.id
     LIMIT GREATEST(1, LEAST(p_limit, 1000))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE jobs_outbox o SET locked_until = now() + make_interval(secs => GREATEST(5, p_lock_seconds))
    FROM picked WHERE o.id = picked.id
  RETURNING o.*;
END
$$;

CREATE OR REPLACE FUNCTION app.complete_outbox(p_ids BIGINT[]) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE v_n INT;
BEGIN
  UPDATE jobs_outbox SET status = 'published', published_at = now(), locked_until = NULL, last_error = NULL
   WHERE id = ANY(p_ids) AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

-- Marks one attempt as failed. Below p_max_attempts the row returns to pending after the backoff;
-- at the limit it becomes 'failed' and stays visible in the dead-letter list until retried by hand.
CREATE OR REPLACE FUNCTION app.fail_outbox(p_id BIGINT, p_error TEXT, p_retry_after_seconds INT DEFAULT 30, p_max_attempts INT DEFAULT 5)
RETURNS outbox_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE v_attempts INT; v_status outbox_status;
BEGIN
  UPDATE jobs_outbox SET attempts = attempts + 1, last_error = left(p_error, 2000), locked_until = NULL
   WHERE id = p_id RETURNING attempts INTO v_attempts;
  IF v_attempts IS NULL THEN RETURN NULL; END IF;
  IF v_attempts >= p_max_attempts THEN
    UPDATE jobs_outbox SET status = 'failed' WHERE id = p_id;
    v_status := 'failed';
  ELSE
    UPDATE jobs_outbox SET available_at = now() + make_interval(secs => p_retry_after_seconds * v_attempts) WHERE id = p_id;
    v_status := 'pending';
  END IF;
  RETURN v_status;
END
$$;

REVOKE EXECUTE ON FUNCTION app.claim_outbox_batch(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.complete_outbox(BIGINT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.fail_outbox(BIGINT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_outbox_batch(INT, INT) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.complete_outbox(BIGINT[]) TO edupro_app;
GRANT EXECUTE ON FUNCTION app.fail_outbox(BIGINT, TEXT, INT, INT) TO edupro_app;

-- Convenience for services and procedures: enqueue inside the caller's transaction.
CREATE OR REPLACE FUNCTION app.enqueue_job(p_queue TEXT, p_payload JSONB, p_available_at TIMESTAMPTZ DEFAULT now())
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO jobs_outbox (school_id, queue, payload, available_at, request_id, created_by)
  VALUES (app.current_school_id(), p_queue, p_payload, COALESCE(p_available_at, now()), app.current_request_id(), app.current_user_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- Communication: templates with DLT ids and a delivery log (WP11, S3-02)
-- ---------------------------------------------------------------------------
CREATE TYPE comms_channel AS ENUM ('sms', 'whatsapp', 'email', 'push');
CREATE TYPE comms_message_status AS ENUM ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled');

CREATE TABLE comms_templates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  code             TEXT NOT NULL,
  channel          comms_channel NOT NULL,
  name             TEXT NOT NULL,
  subject          TEXT,
  body             TEXT NOT NULL,
  variables        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["student_name", "amount"]
  dlt_template_id  TEXT,                                  -- TRAI DLT content template id (SMS)
  dlt_entity_id    TEXT,                                  -- principal entity id
  sender_id        TEXT,                                  -- SMS header or email from address
  status           row_status NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ,
  UNIQUE (school_id, code, channel)
);

CREATE TABLE comms_messages (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  template_id          BIGINT REFERENCES comms_templates(id),
  channel              comms_channel NOT NULL,
  recipient_user_id    BIGINT REFERENCES users(id),
  recipient_address    TEXT NOT NULL,                     -- mobile, email or device token (masked in audit)
  subject              TEXT,
  body                 TEXT NOT NULL,
  variables            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               comms_message_status NOT NULL DEFAULT 'queued',
  provider             TEXT,
  provider_message_id  TEXT,
  attempts             INT NOT NULL DEFAULT 0,
  last_error           TEXT,
  scheduled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  request_id           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           BIGINT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comms_messages_by_status ON comms_messages (school_id, status, scheduled_at);
CREATE INDEX comms_messages_by_recipient ON comms_messages (school_id, recipient_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Exports (S3-03): a request row, a job through the outbox, a file through the file service
-- ---------------------------------------------------------------------------
CREATE TYPE export_status AS ENUM ('queued', 'running', 'ready', 'failed', 'expired');

CREATE TABLE exports (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  dataset        TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('xlsx', 'csv', 'pdf')),
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  title          TEXT NOT NULL,
  status         export_status NOT NULL DEFAULT 'queued',
  file_id        BIGINT REFERENCES files(id),
  row_count      INT,
  error          TEXT,
  requested_by   BIGINT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  download_count INT NOT NULL DEFAULT 0,
  request_id     UUID
);
CREATE INDEX exports_by_requester ON exports (school_id, requested_by, requested_at DESC);
CREATE INDEX exports_expiring ON exports (expires_at) WHERE status = 'ready';

CALL app.apply_tenant_rls('comms_templates');
CALL app.apply_tenant_rls('comms_messages');
CALL app.apply_tenant_rls('exports');

-- ---------------------------------------------------------------------------
-- Permissions and templates
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('comms.template.view',    'comms',    'View notification templates', false),
  ('comms.template.manage',  'comms',    'Create and edit notification templates', false),
  ('comms.message.send',     'comms',    'Send notifications', false),
  ('comms.message.view',     'comms',    'View the delivery log', false),
  ('reports.export.create',  'reports',  'Request PDF, Excel and CSV exports', false),
  ('reports.export.view',    'reports',  'View and download exports', false),
  ('platform.jobs.view',     'platform', 'View background jobs and the dead-letter list', false),
  ('platform.jobs.manage',   'platform', 'Retry or cancel background jobs', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('comms.template.view', 'comms.template.manage', 'comms.message.send', 'comms.message.view',
                 'reports.export.create', 'reports.export.view', 'platform.jobs.view', 'platform.jobs.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('comms.template.view', 'comms.message.view', 'reports.export.create', 'reports.export.view', 'platform.jobs.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'support_engineer'
  AND p.code IN ('platform.jobs.view', 'platform.jobs.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('academic_coordinator', 'class_teacher', 'subject_teacher')
  AND p.code IN ('reports.export.create', 'reports.export.view', 'comms.message.send', 'comms.template.view')
ON CONFLICT DO NOTHING;

-- Audit partitions for the current and next two months so the default partition stays empty locally.
CALL app.ensure_audit_partitions(2);
