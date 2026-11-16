-- 0390: re-issue with today's settings (docs/design/87, 16 Nov 2026): a certificate made again from an earlier one —
-- the same type, person, purpose and details, printed with the signatory, layout and school details as they are now —
-- points to it; the earlier one is cancelled in the same step (its number is never given again). One re-issue each.
ALTER TABLE certificates ADD COLUMN reissue_of BIGINT REFERENCES certificates(id);
CREATE UNIQUE INDEX certificates_reissue_of ON certificates (reissue_of) WHERE reissue_of IS NOT NULL;
