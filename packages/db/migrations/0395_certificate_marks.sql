-- 0395: a cancelled certificate is never printed clean again (17 Nov 2026). From today a cancel retires the
-- certificate's clean PDFs and its PDF is made again with CANCELLED across it (the workers print the word); a batch PDF
-- holding it is made again with that page marked. This catches up the certificates cancelled before:
--   1. a bulk run's section PDF holding one: made again (a new export, queued for the workers), the clean one retired;
--   2. the clean PDFs of each (its revisions' too) and of an old TC cancelled before the register: retired — no longer
--      handed out, cleared by the expiry job — so the certificate's View / Download makes it again, marked.
-- An export still being made needs nothing: the workers read the cancel when they make it.

DO $$
DECLARE
  b RECORD;
  v_new BIGINT;
BEGIN
  FOR b IN
    SELECT DISTINCT e.id, e.school_id, e.dataset, e.format, e.params, e.title, e.requested_by, e.expires_at
      FROM certificate_batches cb
      JOIN exports e ON e.id = cb.export_id
     WHERE e.status = 'ready' AND e.expires_at > now()
       AND EXISTS (SELECT 1 FROM certificates x WHERE x.id = ANY (cb.certificate_ids) AND x.status = 'cancelled')
  LOOP
    INSERT INTO exports (school_id, dataset, format, params, title, requested_by, expires_at)
    VALUES (b.school_id, b.dataset, b.format, b.params, b.title, b.requested_by, b.expires_at)
    RETURNING id INTO v_new;
    UPDATE exports SET expires_at = now() WHERE id = b.id;
    UPDATE certificate_batches SET export_id = v_new WHERE export_id = b.id;
    INSERT INTO jobs_outbox (school_id, queue, payload)
    VALUES (b.school_id, 'exports', jsonb_build_object(
      'schoolId', b.school_id::text,
      'userId', b.requested_by::text,
      'requestId', NULL,
      'kind', 'export.generate',
      'payload', jsonb_build_object('exportId', v_new::text)));
  END LOOP;
END
$$;

WITH retired AS (
  UPDATE exports e
     SET expires_at = now()
   WHERE e.status = 'ready' AND e.expires_at > now()
     AND e.dataset IN ('certificate_doc', 'certificate', 'document')
     AND (e.id IN (SELECT export_id FROM certificates WHERE status = 'cancelled' AND export_id IS NOT NULL)
          OR e.id IN (SELECT r.export_id FROM certificate_revisions r JOIN certificates x ON x.id = r.certificate_id
                       WHERE x.status = 'cancelled' AND r.export_id IS NOT NULL)
          OR e.id IN (SELECT export_id FROM transfer_certificates WHERE status = 'cancelled' AND export_id IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM certificates y WHERE y.export_id = e.id AND y.status = 'issued')
     AND NOT EXISTS (SELECT 1 FROM transfer_certificates t WHERE t.export_id = e.id AND t.status = 'issued')
  RETURNING e.id
)
UPDATE certificates x
   SET export_id = NULL
  FROM retired
 WHERE x.export_id = retired.id AND x.status = 'cancelled';
