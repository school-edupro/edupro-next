-- 0412: the assistant with Claude's help (docs/design/93, phase B). The school switches Claude on per audience (for
-- now teachers and office / admin staff only: families wait for a consent that names Anthropic); Mobilise, which holds
-- the one API key, sets a school's monthly limit of Claude answers (NULL: the server's default). The school's API
-- never writes the limit: it is changed by Mobilise's script (scripts/ai/claude-limit.mjs) as the database owner.
ALTER TABLE assistant_settings
  -- {teacher, admin, parent, student}: true / false (missing: off)
  ADD COLUMN claude               JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(claude) = 'object'),
  ADD COLUMN claude_monthly_limit INT CHECK (claude_monthly_limit IS NULL OR claude_monthly_limit BETWEEN 0 AND 1000000);
