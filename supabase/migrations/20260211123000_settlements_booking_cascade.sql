BEGIN;
ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS settlements_booking_id_fkey;
ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_booking_id_fkey
  FOREIGN KEY (booking_id)
  REFERENCES public.bookings(id)
  ON DELETE CASCADE;
COMMIT;
