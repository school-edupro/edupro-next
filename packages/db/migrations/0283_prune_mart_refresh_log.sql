-- The marts' refresh log gained four rows per school every fifteen minutes and was never trimmed: on the
-- dev database it reached 61 million rows (12 GB of 14). The dashboard reads only each mart's last
-- refresh, so the nightly retention run keeps a week (apps/workers retention.purge).
CREATE OR REPLACE FUNCTION app.prune_mart_refresh_log(p_days INT DEFAULT 7) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n INT;
BEGIN
  DELETE FROM mart.refresh_log WHERE refreshed_at < now() - make_interval(days => GREATEST(p_days, 1));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION app.prune_mart_refresh_log(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_mart_refresh_log(INT) TO edupro_app;
