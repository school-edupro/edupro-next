-- 0194: an attachment question (docs/design/32-employee-acr.md, 20 Oct 2026): the person answering uploads
-- up to three of their own files (images or PDFs) as the answer; not scored.
ALTER TABLE acr_questions DROP CONSTRAINT acr_questions_kind_check;
ALTER TABLE acr_questions ADD CONSTRAINT acr_questions_kind_check CHECK (kind IN ('scale', 'text', 'yesno', 'file'));
