-- Library, part 6 (docs/design/36-library.md): periodical subscriptions. A subscription is a periodical
-- (the master of part 1) taken in a library for a period: the vendor, the copies, the cost, the order and
-- the bill. Its issues are expected from the frequency (each from the first issue, so a monthly issue keeps
-- its day), received (the day, the copies, volume and number) or marked missing (to claim from the
-- vendor); an issue is late once its grace days have passed. A special issue can be added.

CREATE TABLE library_subscriptions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  periodical_id    BIGINT NOT NULL REFERENCES library_periodicals(id),
  library_id       BIGINT NOT NULL REFERENCES library_libraries(id),
  vendor_id        BIGINT REFERENCES library_vendors(id),
  frequency        TEXT NOT NULL CHECK (frequency IN ('Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Bi-monthly',
                                                      'Quarterly', 'Half-yearly', 'Yearly')),
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL,
  first_issue_on   DATE NOT NULL,
  copies           INT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 50),
  cost             NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
  order_no         TEXT,
  bill_no          TEXT,
  bill_date        DATE,
  grace_days       INT NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 90),
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_on     DATE,
  cancel_reason    TEXT,
  renewed_from     BIGINT REFERENCES library_subscriptions(id),
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (ends_on <= starts_on + 1830),
  CHECK (first_issue_on BETWEEN starts_on AND ends_on)
);
CREATE INDEX library_subscriptions_by_periodical ON library_subscriptions (school_id, periodical_id, ends_on);
CALL app.apply_tenant_rls('library_subscriptions');

CREATE TABLE library_periodical_issues (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  subscription_id   BIGINT NOT NULL REFERENCES library_subscriptions(id) ON DELETE CASCADE,
  expected_on       DATE NOT NULL,
  label             TEXT NOT NULL,
  special           BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'received', 'missing')),
  received_on       DATE,
  copies_received   INT CHECK (copies_received IS NULL OR copies_received BETWEEN 0 AND 50),
  volume            TEXT,
  issue_no          TEXT,
  remarks           TEXT,
  marked_by         BIGINT,
  marked_by_name    TEXT,
  marked_at         TIMESTAMPTZ,
  UNIQUE (subscription_id, expected_on, label)
);
CREATE INDEX library_periodical_issues_due ON library_periodical_issues (school_id, status, expected_on);
CALL app.apply_tenant_rls('library_periodical_issues');

-- the days a periodical is expected, from its first issue to the end of the subscription
CREATE OR REPLACE FUNCTION app.library_issue_dates(p_first DATE, p_ends DATE, p_frequency TEXT)
RETURNS TABLE (expected_on DATE, label TEXT) LANGUAGE sql IMMUTABLE AS $$
  WITH steps AS (
    SELECT n,
           CASE p_frequency
             WHEN 'Daily' THEN p_first + n
             WHEN 'Weekly' THEN p_first + 7 * n
             WHEN 'Fortnightly' THEN p_first + 14 * n
             WHEN 'Monthly' THEN (p_first + make_interval(months => n))::date
             WHEN 'Bi-monthly' THEN (p_first + make_interval(months => 2 * n))::date
             WHEN 'Quarterly' THEN (p_first + make_interval(months => 3 * n))::date
             WHEN 'Half-yearly' THEN (p_first + make_interval(months => 6 * n))::date
             WHEN 'Yearly' THEN (p_first + make_interval(years => n))::date
           END AS d
      FROM generate_series(0, 2000) AS n
  )
  SELECT d,
         CASE WHEN p_frequency IN ('Daily', 'Weekly', 'Fortnightly') THEN to_char(d, 'DD-MM-YYYY')
              WHEN p_frequency = 'Yearly' THEN to_char(d, 'YYYY')
              ELSE to_char(d, 'FMMonth YYYY') END
    FROM steps WHERE d <= p_ends ORDER BY d
$$;
