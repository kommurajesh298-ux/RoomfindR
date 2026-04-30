BEGIN;
DO $$
DECLARE
    pattern CONSTANT text := '(payment|payout|settlement|refund|commission|webhook|transaction|wallet|reconciliation|cashfree|razorpay|stripe|ledger|manual_payment|rent_ledger)';
    rec record;
BEGIN
    -- Drop policies tied to payment-related objects.
    FOR rec IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname IN ('public', 'ledger')
          AND (
            tablename ~* pattern
            OR policyname ~* pattern
            OR coalesce(qual, '') ~* pattern
            OR coalesce(with_check, '') ~* pattern
          )
    LOOP
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            rec.policyname,
            rec.schemaname,
            rec.tablename
        );
    END LOOP;

    -- Drop triggers referencing payment-related logic.
    FOR rec IN
        SELECT event_object_schema, event_object_table, trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema IN ('public', 'ledger')
          AND (
            trigger_name ~* pattern
            OR event_object_table ~* pattern
            OR action_statement ~* pattern
          )
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON %I.%I',
            rec.trigger_name,
            rec.event_object_schema,
            rec.event_object_table
        );
    END LOOP;

    -- Drop payment-related routines by name in project schemas only.
    -- Avoid pg_get_functiondef() so aggregate/internal routines cannot break execution.
    FOR rec IN
        SELECT n.nspname AS schema_name,
               p.proname AS routine_name,
               p.prokind AS routine_kind,
               pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'ledger')
          AND p.prokind IN ('f', 'p')
          AND p.proname ~* pattern
    LOOP
        IF rec.routine_kind = 'p' THEN
            EXECUTE format(
                'DROP PROCEDURE IF EXISTS %I.%I(%s) CASCADE',
                rec.schema_name,
                rec.routine_name,
                rec.identity_args
            );
        ELSE
            EXECUTE format(
                'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
                rec.schema_name,
                rec.routine_name,
                rec.identity_args
            );
        END IF;
    END LOOP;

    -- Drop payment-related views/materialized views.
    FOR rec IN
        SELECT n.nspname AS schema_name, c.relname AS rel_name, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'ledger')
          AND c.relkind IN ('v', 'm')
          AND c.relname ~* pattern
    LOOP
        IF rec.relkind = 'm' THEN
            EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', rec.schema_name, rec.rel_name);
        ELSE
            EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', rec.schema_name, rec.rel_name);
        END IF;
    END LOOP;

    -- Drop known payment-related tables explicitly.
    EXECUTE 'DROP TABLE IF EXISTS public.admin_commission_settings CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.manual_payment_logs CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.payment_logs CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.payments CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.payouts CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.refunds CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.reconciliation_issues CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.reconciliation_runs CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.rent_ledger CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.settlement_dedupe_audit CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.settlements CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.transaction_logs CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.wallet_transactions CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.wallets CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.webhook_logs CASCADE';

    -- Drop any remaining payment-like tables by pattern.
    FOR rec IN
        SELECT n.nspname AS schema_name, c.relname AS rel_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'ledger')
          AND c.relkind = 'r'
          AND c.relname ~* pattern
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', rec.schema_name, rec.rel_name);
    END LOOP;

    -- Drop payment-like sequences.
    FOR rec IN
        SELECT sequence_schema, sequence_name
        FROM information_schema.sequences
        WHERE sequence_schema IN ('public', 'ledger')
          AND sequence_name ~* pattern
    LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS %I.%I CASCADE', rec.sequence_schema, rec.sequence_name);
    END LOOP;

    -- Drop payment-like custom types.
    FOR rec IN
        SELECT n.nspname AS schema_name, t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname IN ('public', 'ledger')
          AND t.typname ~* pattern
          AND t.typtype IN ('e', 'c', 'd')
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', rec.schema_name, rec.typname);
    END LOOP;

    -- Drop payment-like publications.
    FOR rec IN
        SELECT pubname
        FROM pg_publication
        WHERE pubname ~* pattern
    LOOP
        EXECUTE format('DROP PUBLICATION IF EXISTS %I', rec.pubname);
    END LOOP;

    -- Drop cron jobs tied to payment stack (if pg_cron is enabled).
    IF to_regclass('cron.job') IS NOT NULL THEN
        FOR rec IN
            SELECT jobid
            FROM cron.job
            WHERE coalesce(command, '') ~* pattern
               OR coalesce(jobname, '') ~* pattern
        LOOP
            PERFORM cron.unschedule(rec.jobid);
        END LOOP;
    END IF;

    -- Drop legacy ledger schema entirely.
    EXECUTE 'DROP SCHEMA IF EXISTS ledger CASCADE';
END
$$;
COMMIT;
