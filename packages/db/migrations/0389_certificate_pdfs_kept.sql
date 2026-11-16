-- 0389: a certificate's PDF is kept for good (16 Nov 2026): a certificate is a record, not a report export, so its PDF
-- (and a bulk issue's batch print) is no longer cleared after the exports' seven days. Those not cleared yet are kept;
-- one already cleared is made again the next time it is opened (POST /certificates/:id/pdf).
UPDATE exports
   SET expires_at = GREATEST(expires_at, now() + interval '100 years')
 WHERE status IN ('queued', 'running', 'ready')
   AND (dataset IN ('certificate_doc', 'certificate_batch_doc')
        OR id IN (SELECT export_id FROM certificates WHERE export_id IS NOT NULL));
