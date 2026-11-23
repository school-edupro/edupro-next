-- 0419: running a generated data question (docs/design/103, phase A).
-- The app never switches to edupro_nlq itself (signed in as edupro_app, a query could switch back with
-- set_config('role', …)). Instead it calls app.nlq_run: a SECURITY DEFINER function owned by edupro_nlq, inside which
-- PostgreSQL refuses any change of role. So the query reads as edupro_nlq — the nlq views only — and, because the
-- views keep their spine to app.nlq_school_id(), only the school the app began the question for.
-- The app's order, in one transaction that is rolled back: tenant context → app.nlq_begin() →
-- SET LOCAL transaction_read_only = on → SET LOCAL statement_timeout → SELECT app.nlq_run($1, $2).

REVOKE edupro_nlq FROM edupro_app;
GRANT edupro_nlq TO CURRENT_USER;

CREATE FUNCTION app.nlq_run(p_sql text, p_limit int)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = nlq, pg_catalog AS $$
BEGIN
  IF app.nlq_school_id() IS NULL THEN
    RAISE EXCEPTION 'nlq: no question in progress' USING ERRCODE = '42501';
  END IF;
  -- one SELECT / WITH, run as a sub-query (a second statement or a data-modifying WITH cannot stand there)
  RETURN QUERY EXECUTE format('SELECT row_to_json(q) FROM (%s) q LIMIT %s', p_sql, greatest(1, least(p_limit, 50001)));
END
$$;
ALTER FUNCTION app.nlq_run(text, int) OWNER TO edupro_nlq;
REVOKE ALL ON FUNCTION app.nlq_run(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.nlq_run(text, int) TO edupro_app;
