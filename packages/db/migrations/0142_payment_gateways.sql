-- 0142: payment gateways set up by the school, and which fee each one takes.
--  * payment_gateways: the school's accounts with PayU, CCAvenue, Razorpay, SBI ePay or Atom (several of a
--    kind may exist, e.g. two merchant accounts). Test or live; the keys are kept encrypted (secret, as the
--    comms providers) and never returned; a convenience charge (% and/or flat, 0 = the school bears it).
--  * payment_gateway_routes: the gateways a fee type (school, hostel, misc, admission) is paid through, in
--    order; with more than one the payer chooses.
--  * A payment records the gateway account it went through and the convenience charge on top of the fee;
--    the gateway's answer is checked with that account's keys (found before any school is known).
CREATE TABLE payment_gateways (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  provider       TEXT NOT NULL CHECK (provider IN ('payu', 'ccavenue', 'razorpay', 'sbiepay', 'atom', 'mock')),
  label          TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- what is not secret: merchant id, key id, access code ...
  secret         TEXT,                                 -- encrypted JSON of the keys (salt, working key ...)
  charge_percent NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (charge_percent >= 0 AND charge_percent <= 20),
  charge_flat    NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (charge_flat >= 0),
  active         BOOLEAN NOT NULL DEFAULT true,
  bank_account_id BIGINT REFERENCES school_bank_accounts(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT
);
CALL app.apply_tenant_rls('payment_gateways');
CREATE TRIGGER payment_gateways_audit AFTER INSERT OR UPDATE OR DELETE ON payment_gateways FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE payment_gateway_routes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  ledger      ledger_type NOT NULL,
  gateway_id  BIGINT NOT NULL REFERENCES payment_gateways(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (ledger, gateway_id)
);
CALL app.apply_tenant_rls('payment_gateway_routes');
CREATE TRIGGER payment_gateway_routes_audit AFTER INSERT OR UPDATE OR DELETE ON payment_gateway_routes FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE payment_intents
  ADD COLUMN gateway_id BIGINT REFERENCES payment_gateways(id),
  ADD COLUMN charge NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (charge >= 0);
-- the convenience charge a receipt's online payment carried (income apart from the fee)
ALTER TABLE fee_payments ADD COLUMN convenience_charge NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE misc_receipts ADD COLUMN convenience_charge NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- A gateway account by id, before any school is chosen (the gateway's return names it): only for checking
-- the gateway's signature or decrypting its answer.
CREATE OR REPLACE FUNCTION app.payment_gateway_lookup(p_id bigint)
RETURNS TABLE (school_id bigint, provider text, mode text, config jsonb, secret text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT school_id, provider, mode, config, secret FROM payment_gateways WHERE id = p_id
$$;
REVOKE EXECUTE ON FUNCTION app.payment_gateway_lookup(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_gateway_lookup(bigint) TO edupro_app;

-- The gateway account a transaction went through (PayU / Razorpay notifications name only the transaction).
CREATE OR REPLACE FUNCTION app.payment_intent_gateway(p_txn_id text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT gateway_id FROM payment_intents WHERE txn_id = p_txn_id
$$;
REVOKE EXECUTE ON FUNCTION app.payment_intent_gateway(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_intent_gateway(text) TO edupro_app;

CREATE OR REPLACE FUNCTION app.payment_order_gateway(p_provider text, p_order_id text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT gateway_id FROM payment_intents WHERE provider = p_provider AND provider_order_id = p_order_id
$$;
REVOKE EXECUTE ON FUNCTION app.payment_order_gateway(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_order_gateway(text, text) TO edupro_app;
