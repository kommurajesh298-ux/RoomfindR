BEGIN;
-- 1) Commission settings (admin editable)
CREATE TABLE IF NOT EXISTS public.admin_commission_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 10,
    active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_admin_id UUID REFERENCES public.admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Insert default commission setting if table is empty
INSERT INTO public.admin_commission_settings (commission_percentage, active_from)
SELECT 10, NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.admin_commission_settings);
-- 2) Rent payments (one per booking per month)
CREATE TABLE IF NOT EXISTS public.rent_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    rent_amount NUMERIC(10, 2) NOT NULL,
    paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('paid', 'partial', 'pending', 'failed')),
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS rent_payments_unique_booking_month
    ON public.rent_payments (booking_id, year, month);
CREATE INDEX IF NOT EXISTS idx_rent_payments_owner ON public.rent_payments(owner_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_user ON public.rent_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_property ON public.rent_payments(property_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_month_year ON public.rent_payments(year, month);
-- 3) Commission records (one per rent payment)
CREATE TABLE IF NOT EXISTS public.commission_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rent_payment_id UUID NOT NULL REFERENCES public.rent_payments(id) ON DELETE CASCADE,
    rent_amount NUMERIC(10, 2) NOT NULL,
    commission_percentage NUMERIC(5, 2) NOT NULL,
    commission_amount NUMERIC(10, 2) NOT NULL,
    owner_amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS commission_records_unique_rent_payment
    ON public.commission_records (rent_payment_id);
-- 4) Owner monthly summary (optional optimization)
CREATE TABLE IF NOT EXISTS public.owner_monthly_summary (
    owner_id UUID NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    total_rent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_pending NUMERIC(12, 2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, year, month)
);
-- 5) Updated-at triggers
DROP TRIGGER IF EXISTS update_rent_payments_updated_at ON public.rent_payments;
CREATE TRIGGER update_rent_payments_updated_at
    BEFORE UPDATE ON public.rent_payments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_admin_commission_settings_updated_at ON public.admin_commission_settings;
CREATE TRIGGER update_admin_commission_settings_updated_at
    BEFORE UPDATE ON public.admin_commission_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- 6) Summary refresh helpers
CREATE OR REPLACE FUNCTION public.refresh_owner_monthly_summary(p_owner_id UUID, p_year INTEGER, p_month INTEGER)
RETURNS VOID AS $$
DECLARE
    totals RECORD;
BEGIN
    SELECT
        COALESCE(SUM(rent_amount), 0) AS total_rent,
        COALESCE(SUM(paid_amount), 0) AS total_paid
    INTO totals
    FROM public.rent_payments
    WHERE owner_id = p_owner_id
      AND year = p_year
      AND month = p_month;

    INSERT INTO public.owner_monthly_summary (owner_id, year, month, total_rent, total_paid, total_pending, last_updated)
    VALUES (
        p_owner_id,
        p_year,
        p_month,
        COALESCE(totals.total_rent, 0),
        COALESCE(totals.total_paid, 0),
        GREATEST(COALESCE(totals.total_rent, 0) - COALESCE(totals.total_paid, 0), 0),
        NOW()
    )
    ON CONFLICT (owner_id, year, month)
    DO UPDATE SET
        total_rent = EXCLUDED.total_rent,
        total_paid = EXCLUDED.total_paid,
        total_pending = EXCLUDED.total_pending,
        last_updated = NOW();
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION public.rent_payments_refresh_summary()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        PERFORM public.refresh_owner_monthly_summary(OLD.owner_id, OLD.year, OLD.month);
        RETURN OLD;
    END IF;

    PERFORM public.refresh_owner_monthly_summary(NEW.owner_id, NEW.year, NEW.month);

    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.year IS DISTINCT FROM NEW.year OR OLD.month IS DISTINCT FROM NEW.month) THEN
            PERFORM public.refresh_owner_monthly_summary(OLD.owner_id, OLD.year, OLD.month);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rent_payments_summary_trigger ON public.rent_payments;
CREATE TRIGGER rent_payments_summary_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.rent_payments
    FOR EACH ROW EXECUTE FUNCTION public.rent_payments_refresh_summary();
-- 7) Enable RLS
ALTER TABLE public.admin_commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_monthly_summary ENABLE ROW LEVEL SECURITY;
-- 8) Policies (admin)
DROP POLICY IF EXISTS admin_commission_settings_all ON public.admin_commission_settings;
CREATE POLICY admin_commission_settings_all ON public.admin_commission_settings
    FOR ALL USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_rent_payments_all ON public.rent_payments;
CREATE POLICY admin_rent_payments_all ON public.rent_payments
    FOR ALL USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_commission_records_all ON public.commission_records;
CREATE POLICY admin_commission_records_all ON public.commission_records
    FOR ALL USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS admin_owner_monthly_summary_all ON public.owner_monthly_summary;
CREATE POLICY admin_owner_monthly_summary_all ON public.owner_monthly_summary
    FOR ALL USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));
-- 9) Policies (owners/customers view)
DROP POLICY IF EXISTS rent_payments_view ON public.rent_payments;
CREATE POLICY rent_payments_view ON public.rent_payments
    FOR SELECT USING (
        owner_id = auth.uid()
        OR user_id = auth.uid()
        OR public.is_admin(auth.uid())
    );
DROP POLICY IF EXISTS commission_records_view ON public.commission_records;
CREATE POLICY commission_records_view ON public.commission_records
    FOR SELECT USING (
        public.is_admin(auth.uid())
        OR EXISTS (
            SELECT 1
            FROM public.rent_payments rp
            WHERE rp.id = commission_records.rent_payment_id
              AND (rp.owner_id = auth.uid() OR rp.user_id = auth.uid())
        )
    );
DROP POLICY IF EXISTS owner_monthly_summary_view ON public.owner_monthly_summary;
CREATE POLICY owner_monthly_summary_view ON public.owner_monthly_summary
    FOR SELECT USING (
        owner_id = auth.uid()
        OR public.is_admin(auth.uid())
    );
-- 10) Realtime publication
ALTER TABLE public.rent_payments REPLICA IDENTITY FULL;
ALTER TABLE public.commission_records REPLICA IDENTITY FULL;
ALTER TABLE public.owner_monthly_summary REPLICA IDENTITY FULL;
ALTER TABLE public.admin_commission_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'rent_payments'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.rent_payments';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'commission_records'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_records';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'owner_monthly_summary'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_monthly_summary';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_publication p ON p.oid = pr.prpubid
        WHERE p.pubname = 'supabase_realtime'
          AND c.relname = 'admin_commission_settings'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_commission_settings';
    END IF;
END $$;
COMMIT;
