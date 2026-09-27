-- 0011_sprint3_export_expiry.sql
-- Sprint 3: expiry of generated export files. Cross-tenant by nature (the maintenance job runs for every
-- school), so SECURITY DEFINER with a narrow surface, like app.claim_outbox_batch in 0010.

CREATE OR REPLACE FUNCTION app.expire_exports(p_limit INT DEFAULT 200)
RETURNS TABLE (o_export_id BIGINT, o_school_id BIGINT, o_file_id BIGINT, o_bucket TEXT, o_object_key TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT x.id FROM exports x
     WHERE x.status = 'ready' AND x.expires_at < now()
     ORDER BY x.expires_at
     LIMIT GREATEST(1, LEAST(p_limit, 1000))
     FOR UPDATE SKIP LOCKED
  ),
  e AS (
    UPDATE exports x SET status = 'expired'
      FROM picked WHERE x.id = picked.id
    RETURNING x.id, x.school_id, x.file_id
  ),
  f AS (
    UPDATE files fl SET deleted_at = now()
     WHERE fl.id IN (SELECT e.file_id FROM e WHERE e.file_id IS NOT NULL) AND fl.deleted_at IS NULL
    RETURNING fl.id, fl.bucket, fl.object_key
  )
  SELECT e.id, e.school_id, e.file_id, f.bucket, f.object_key
    FROM e LEFT JOIN f ON f.id = e.file_id;
END
$$;
REVOKE EXECUTE ON FUNCTION app.expire_exports(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_exports(INT) TO edupro_app;
