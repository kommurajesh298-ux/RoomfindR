-- Create missing occupancy RPCs used by check-in / check-out
create or replace function public.increment_room_occupancy(room_id uuid)
returns void
language plpgsql
as $$
begin
  update public.rooms
  set booked_count = booked_count + 1,
      is_available = case
        when booked_count + 1 >= capacity then false
        else true
      end
  where id = room_id;
end;
$$;
create or replace function public.decrement_room_occupancy(room_id uuid)
returns void
language plpgsql
as $$
begin
  update public.rooms
  set booked_count = greatest(0, booked_count - 1),
      is_available = true
  where id = room_id;
end;
$$;
grant execute on function public.increment_room_occupancy(uuid) to authenticated;
grant execute on function public.decrement_room_occupancy(uuid) to authenticated;
grant execute on function public.increment_room_occupancy(uuid) to service_role;
grant execute on function public.decrement_room_occupancy(uuid) to service_role;
