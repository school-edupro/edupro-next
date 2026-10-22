-- 0218: each renewal of a loan kept with its day, the due dates before and after, and who renewed it, so
-- the circulation history (docs/design/36-library.md, "Library reports", part 2) lists renewals between
-- two days as it lists issues and returns. A loan kept only how many times it was renewed.
CREATE TABLE library_loan_renewals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  loan_id     BIGINT NOT NULL REFERENCES library_loans(id),
  renewed_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  from_due    DATE,
  to_due      DATE,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX library_loan_renewals_loan ON library_loan_renewals (loan_id);
CREATE INDEX library_loan_renewals_day ON library_loan_renewals (school_id, renewed_on);
CALL app.apply_tenant_rls('library_loan_renewals');

-- the renewals made before: from the audit log (the day in India time and who; the due dates are not known)
INSERT INTO library_loan_renewals (school_id, loan_id, renewed_on, by_user, by_name, at)
SELECT l.school_id, l.id, (a.occurred_at AT TIME ZONE 'Asia/Kolkata')::date, a.actor_user_id, u.display_name, a.occurred_at
  FROM audit_logs a
  JOIN library_loans l ON l.id::text = a.entity_id AND l.school_id = a.school_id
  LEFT JOIN users u ON u.id = a.actor_user_id
 WHERE a.action = 'library.renew' AND a.entity_type = 'library_loans';
