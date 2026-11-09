-- An opening line reversed exactly (docs/design/84, "As built — opening stock corrections", 9 Nov 2026):
-- the same quantity and value come out as went in (not at the average), batch and all, so a corrected
-- or removed opening leaves nothing behind. Only for an item that has not moved since its opening (the
-- service checks); the ledger stays append-only — this posts an 'opening_undo' move.
CREATE OR REPLACE FUNCTION app.stock_opening_undo(p_move BIGINT, p_note TEXT DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  b RECORD;
  v_new_qty NUMERIC;
  v_new_value NUMERIC;
  v_id BIGINT;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = p_move AND kind = 'opening';
  IF m.id IS NULL THEN RAISE EXCEPTION 'stock.not_opening' USING ERRCODE = 'no_data_found'; END IF;
  IF EXISTS (SELECT 1 FROM stock_moves WHERE kind = 'opening_undo' AND doc_line_id = p_move) THEN
    RAISE EXCEPTION 'stock.opening_undone' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO b FROM stock_balances WHERE store_id = m.store_id AND item_id = m.item_id FOR UPDATE;
  v_new_qty := b.qty - m.qty;
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'stock.insufficient: % in the store, % to reverse', b.qty, m.qty USING ERRCODE = 'check_violation';
  END IF;
  v_new_value := CASE WHEN v_new_qty = 0 THEN 0 ELSE b.value - m.value END;
  IF m.batch_no IS NOT NULL THEN
    UPDATE stock_batches SET qty_left = qty_left - m.qty
     WHERE store_id = m.store_id AND item_id = m.item_id AND batch_no = m.batch_no
       AND expiry IS NOT DISTINCT FROM m.expiry AND qty_left >= m.qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock.insufficient: not enough in the batch' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  UPDATE stock_balances
     SET qty = v_new_qty, value = v_new_value,
         avg_rate = CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 4) ELSE b.avg_rate END,
         last_move_on = (now() AT TIME ZONE 'Asia/Kolkata')::date
   WHERE store_id = m.store_id AND item_id = m.item_id;
  INSERT INTO stock_moves (school_id, store_id, item_id, kind, qty, rate, value, balance_qty, balance_value, batch_no, expiry,
                           doc_type, doc_id, doc_line_id, note, moved_on, created_by)
  VALUES (m.school_id, m.store_id, m.item_id, 'opening_undo', -m.qty, m.rate, -(b.value - v_new_value), v_new_qty, v_new_value,
          m.batch_no, m.expiry, 'opening', m.doc_id, m.id, left(COALESCE(p_note, 'Opening reversed'), 300),
          (now() AT TIME ZONE 'Asia/Kolkata')::date, app.current_user_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
