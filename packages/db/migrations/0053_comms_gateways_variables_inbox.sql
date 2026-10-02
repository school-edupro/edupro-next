-- Communication v2, part 2 (2026-10-02): the gateways the legacy ERP uses (smsbhejo.org DLT SMS and the
-- Mobilise EMS WhatsApp bridge) next to MSG91 / Meta; school custom variables ({{principal_name}},
-- {{fee_pay_link}}...); read marks for the Messages inbox in the parent, student and teacher apps.
ALTER TABLE comms_providers DROP CONSTRAINT IF EXISTS comms_providers_provider_check;
ALTER TABLE comms_providers ADD CONSTRAINT comms_providers_provider_check
  CHECK (provider IN ('msg91', 'smsbhejo', 'meta_whatsapp', 'ems_whatsapp', 'smtp', 'console'));

CREATE TABLE comms_variables (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  key         TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, key)
);
CALL app.apply_tenant_rls('comms_variables');

-- one row per user and message the first time it is opened in an app
CREATE TABLE comms_inbox_reads (
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  message_id  BIGINT NOT NULL REFERENCES comms_messages(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CALL app.apply_tenant_rls('comms_inbox_reads');

CREATE INDEX comms_messages_by_address ON comms_messages (school_id, recipient_address, created_at DESC);
