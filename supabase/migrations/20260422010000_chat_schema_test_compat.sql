BEGIN;

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS unread_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.chats
SET unread_counts = '{}'::jsonb
WHERE unread_counts IS NULL;

COMMIT;
