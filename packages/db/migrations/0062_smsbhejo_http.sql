-- 0062: smsbhejo.org answers on http only; on https it serves the certificate of another host, so every
-- send failed with "fetch failed". Schools that saved the https address (the old placeholder) move to the
-- http address the legacy ERP uses.
UPDATE comms_providers
   SET config = jsonb_set(config, '{url}', to_jsonb(regexp_replace(config ->> 'url', '^https://', 'http://')))
 WHERE provider = 'smsbhejo' AND config ->> 'url' ~* '^https://(www\.)?smsbhejo\.(org|info)/';
