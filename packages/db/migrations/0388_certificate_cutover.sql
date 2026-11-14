-- 0388: certificate management, phase F (docs/design/87): from the old system. The workers read the old certificate
-- register (certificate_master, read only, through the server's own connection — never one typed in the app) and the
-- old TC book's last Sl. No. into a holding area; the school maps each old certificate name to a type here; the
-- certificates then come across as read-only history under their old numbers (a cancelled one stays cancelled, a
-- reprint says it comes from the old system), each type's series and the TC book continue from the last number the
-- old system used, and a count check shows that every old row either came or was left out with its reason.
CREATE TABLE certificate_cutover (
  school_id         BIGINT PRIMARY KEY REFERENCES schools(id),
  read_requested_at TIMESTAMPTZ,
  read_started_at   TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  read_error        TEXT CHECK (read_error IS NULL OR length(read_error) <= 500),
  read_counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- the old TC book's last Sl. No. (its setting), as read
  book_last_sl      INT CHECK (book_last_sl IS NULL OR book_last_sl >= 0),
  -- {"<old certificate name>": "<type code>" | null (not brought)}
  type_map          JSONB NOT NULL DEFAULT '{}'::jsonb,
  brought_at        TIMESTAMPTZ,
  brought_by        BIGINT REFERENCES users(id),
  brought           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('certificate_cutover');
CREATE TRIGGER certificate_cutover_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_cutover
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the old register's rows as read (the row as the old database has it)
CREATE TABLE certificate_legacy_rows (
  school_id BIGINT NOT NULL REFERENCES schools(id),
  srno      BIGINT NOT NULL,
  payload   JSONB NOT NULL,
  read_id   BIGINT NOT NULL,
  PRIMARY KEY (school_id, srno)
);
CALL app.apply_tenant_rls('certificate_legacy_rows');

-- a certificate brought from elsewhere comes once (brought again, it is left as it is)
CREATE UNIQUE INDEX certificates_legacy_ref ON certificates (school_id, legacy_ref) WHERE legacy_ref IS NOT NULL;
