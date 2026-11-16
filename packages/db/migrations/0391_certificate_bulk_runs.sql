-- 0391: bulk issue to several classes and sections at once (docs/design/87, 16 Nov 2026): one run makes a batch for
-- each section (its own PDF in roll order); the batches of a run share its id, for the run's page and its ZIP.
ALTER TABLE certificate_batches ADD COLUMN run_id UUID;
CREATE INDEX certificate_batches_run ON certificate_batches (school_id, run_id) WHERE run_id IS NOT NULL;
