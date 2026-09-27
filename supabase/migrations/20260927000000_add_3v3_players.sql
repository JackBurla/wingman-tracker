-- Existing matches remain 2v2 because both new fields default to NULL.
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS t1p3 text,
  ADD COLUMN IF NOT EXISTS t2p3 text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND conname = 'matches_balanced_team_size'
  ) THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_balanced_team_size CHECK (
      (t1p3 IS NULL AND t2p3 IS NULL)
      OR (t1p3 IS NOT NULL AND t2p3 IS NOT NULL
          AND length(trim(t1p3)) > 0 AND length(trim(t2p3)) > 0)
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
