-- v0.20 closure §12: STABLE STAGE SEMANTICS.
--
-- Business logic (Lead.status derivation, LEAD_QUALIFIED events, follow-up
-- suggestions, lost detection, scoring heuristics) previously read DISPLAY
-- NAMES ("New"/"Contacted"/"Qualified"/"Meeting"/"Proposal"). Display names
-- are user-renamable and localizable — logic keyed on them breaks the moment
-- a stage is renamed. This migration introduces the stable semanticCode
-- column and backfills it DETERMINISTICALLY:
--
--   1. known canonical English default names map to their semantic codes
--      (covers every database seeded from DEFAULT_STAGES);
--   2. structural type wins for final stages: type='won' → WON,
--      type='lost' → LOST (unambiguous, name-independent);
--   3. everything else → CUSTOM (explicit semantics required from now on —
--      renaming a canonical stage does NOT change its behavior).
--
-- Renaming a stage's display name after this migration changes nothing in
-- business behavior: semanticCode is authoritative.

ALTER TABLE "PipelineStage" ADD COLUMN "semanticCode" TEXT NOT NULL DEFAULT 'CUSTOM';

UPDATE "PipelineStage" SET "semanticCode" = CASE "name"
  WHEN 'New' THEN 'NEW'
  WHEN 'Contacted' THEN 'CONTACTED'
  WHEN 'Qualified' THEN 'QUALIFIED'
  WHEN 'Meeting' THEN 'MEETING'
  WHEN 'Proposal' THEN 'PROPOSAL'
  WHEN 'Negotiation' THEN 'NEGOTIATION'
  ELSE 'CUSTOM'
END;

UPDATE "PipelineStage" SET "semanticCode" = 'WON' WHERE "type" = 'won';
UPDATE "PipelineStage" SET "semanticCode" = 'LOST' WHERE "type" = 'lost';
