ALTER TABLE public.settlements
  ALTER COLUMN owner_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'settlements_owner_id_fkey'
      AND conrelid = 'public.settlements'::regclass
  ) THEN
    ALTER TABLE public.settlements
      ADD CONSTRAINT settlements_owner_id_fkey
      FOREIGN KEY (owner_id)
      REFERENCES public.owners(id)
      ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
