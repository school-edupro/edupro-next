-- 0385: certificate management, phase D (docs/design/87). Every certificate prints a QR of its own link
-- (<public site>/<school code>/verify/<token>, the token random and unique); anyone who opens it — or searches a number
-- with its date of issue — sees whether it is valid, cancelled or a duplicate, its type, number and date, the school,
-- and the holder's name masked. No sign-in; rate-limited. Every check is logged here: what was checked, how and what it
-- found — never the address of whoever checked (only a hash of it, to count repeats) and the browser cut short.
CREATE TABLE certificate_verifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  certificate_id BIGINT REFERENCES certificates(id),
  method         TEXT NOT NULL CHECK (method IN ('qr', 'search')),
  result         TEXT NOT NULL CHECK (result IN ('valid', 'cancelled', 'not_found')),
  number_tried   TEXT CHECK (number_tried IS NULL OR length(number_tried) <= 60),
  ip_hash        TEXT CHECK (ip_hash IS NULL OR length(ip_hash) <= 64),
  user_agent     TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 160),
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX certificate_verifications_cert ON certificate_verifications (certificate_id, checked_at DESC)
  WHERE certificate_id IS NOT NULL;
CREATE INDEX certificate_verifications_school ON certificate_verifications (school_id, checked_at DESC);
CALL app.apply_tenant_rls('certificate_verifications');
