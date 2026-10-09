-- 0112: a workflow says who may raise its request. creator_roles holds role codes; an empty list keeps
-- the old rule (anyone whose permissions let them raise it). The engine refuses a request raised by
-- somebody holding none of the roles.
ALTER TABLE workflow_definitions ADD COLUMN creator_roles TEXT[] NOT NULL DEFAULT '{}';
