-- Communication v2, part 3 (2026-10-02): Firebase (FCM) push to the parent / student and teacher apps,
-- push on/off per event (decided by the admin), and the message as recipients get it stored on the request
-- (shown to the approver and on the request page).
ALTER TABLE comms_providers DROP CONSTRAINT IF EXISTS comms_providers_provider_check;
ALTER TABLE comms_providers ADD CONSTRAINT comms_providers_provider_check
  CHECK (provider IN ('msg91', 'smsbhejo', 'meta_whatsapp', 'ems_whatsapp', 'smtp', 'fcm', 'console'));

CREATE TABLE push_devices (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  app         TEXT NOT NULL CHECK (app IN ('parent', 'teacher')),
  token       TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (school_id, token)
);
CALL app.apply_tenant_rls('push_devices');
CREATE INDEX push_devices_by_user ON push_devices (school_id, user_id) WHERE revoked_at IS NULL;

-- school_message, attendance, fees, transport, queries, notices, homework, approvals
ALTER TABLE comms_settings
  ADD COLUMN push_events TEXT[] NOT NULL DEFAULT ARRAY['school_message', 'attendance', 'fees', 'transport', 'queries', 'notices', 'homework', 'approvals'];

-- per channel, the first recipient's message: [{channel, subject, text, html}]
ALTER TABLE message_requests ADD COLUMN preview JSONB;
