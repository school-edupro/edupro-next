-- 0196: instructions per approval level (docs/design/32-employee-acr.md, 20 Oct 2026): shown at the top
-- of the level's step on the ACR sheet; empty = the plain default for the kind of level.
ALTER TABLE acr_levels ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
