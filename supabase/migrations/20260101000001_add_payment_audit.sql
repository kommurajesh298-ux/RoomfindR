-- Migration: Add payment audit logs for Payment Gateway Webhooks
-- Description: Creates a table to store details of all incoming webhook events for compliance and debugging.
CREATE TABLE IF NOT EXISTS public.payment_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES public.payments(id),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    signature TEXT,
    result TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.payment_audit_logs ENABLE ROW LEVEL SECURITY;
-- Add RLS Policies
-- Service role has full access
CREATE POLICY "Service Role Full Access" ON public.payment_audit_logs FOR ALL USING (auth.role() = 'service_role');
-- (Optional) If we want users to see their own payment history audit breadcrumbs, we'd need to join with payments table.
-- For now, let's keep it restricted to service role for internal debugging.;
