begin;

-- Hosted automation was still pointing at the scaffold placeholder URL, so
-- database-triggered rent payouts could never reach the settlement edge function.
insert into public.config (key, value)
values ('supabase_url', 'https://rkabjhgdmluacqjdtjwi.supabase.co')
on conflict (key) do update
set value = excluded.value;

create or replace function public.trigger_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    normalized_status text := lower(coalesce(nullif(NEW.payment_status::text, ''), nullif(NEW.status::text, ''), ''));
    previous_status text := '';
    payment_type text := lower(coalesce(nullif(NEW.payment_type::text, ''), 'booking'));
    is_monthly boolean := payment_type in ('monthly', 'rent', 'monthly_rent');
    booking_status text;
    supabase_url text;
    service_key text;
    headers jsonb;
begin
    if TG_OP not in ('INSERT', 'UPDATE') then
        return NEW;
    end if;

    if TG_OP = 'UPDATE' then
        previous_status := lower(coalesce(nullif(OLD.payment_status::text, ''), nullif(OLD.status::text, ''), ''));
    end if;

    if lower(coalesce(NEW.provider::text, '')) <> 'cashfree' then
        return NEW;
    end if;

    if normalized_status not in ('paid', 'completed', 'success', 'authorized') then
        return NEW;
    end if;

    if TG_OP = 'UPDATE'
       and previous_status = normalized_status
       and previous_status in ('paid', 'completed', 'success', 'authorized') then
        return NEW;
    end if;

    select lower(coalesce(b.status::text, ''))
    into booking_status
    from public.bookings b
    where b.id = NEW.booking_id;

    if booking_status is null then
        return NEW;
    end if;

    -- Monthly rent should pay owners automatically once the stay is live. No
    -- admin approval gate is applied for rent payouts.
    if is_monthly then
        if booking_status not in ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing') then
            return NEW;
        end if;
    else
        if booking_status not in ('approved', 'confirmed', 'checked-in', 'checked_in', 'active', 'ongoing') then
            return NEW;
        end if;
    end if;

    if exists (
        select 1
        from public.settlements s
        where s.payment_id = NEW.id
    ) then
        return NEW;
    end if;

    select value into supabase_url from public.config where key = 'supabase_url';
    select value into service_key from public.config where key = 'supabase_service_role_key';

    if supabase_url is null
       or trim(supabase_url) = ''
       or supabase_url ilike 'REPLACE_WITH_%' then
        supabase_url := 'https://rkabjhgdmluacqjdtjwi.supabase.co';
    end if;

    if service_key is null or trim(service_key) = '' then
        raise notice 'Missing service key for settlement automation';
        return NEW;
    end if;

    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key,
        'x-supabase-auth', 'Bearer ' || service_key
    );

    perform net.http_post(
        url := rtrim(supabase_url, '/') || '/functions/v1/cashfree-settlement',
        headers := headers,
        body := jsonb_build_object(
            'bookingId', NEW.booking_id,
            'paymentId', NEW.id,
            'createOnly', false,
            'trigger', case when is_monthly then 'monthly_rent_autopayout' else 'booking_settlement_autopayout' end,
            'internal_key', service_key
        )
    );

    return NEW;
end;
$$;

drop trigger if exists payments_settlement_trigger on public.payments;
create trigger payments_settlement_trigger
after insert or update on public.payments
for each row
execute function public.trigger_payment_settlement();

notify pgrst, 'reload schema';

commit;
