-- Fix admin detection for schemas where public.admins has no user_id column

CREATE OR REPLACE FUNCTION public.cashfree_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_admin boolean := FALSE;
  v_has_admins_user_id boolean := FALSE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.is_admin_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT EXISTS (
           SELECT 1
           FROM public.is_admin_accounts
           WHERE user_id = $1
             AND COALESCE(is_admin, TRUE) = TRUE
         )'
      INTO v_is_admin
      USING p_user_id;
      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN undefined_column THEN
        BEGIN
          EXECUTE
            'SELECT EXISTS (
               SELECT 1
               FROM public.is_admin_accounts
               WHERE user_id = $1
             )'
          INTO v_is_admin
          USING p_user_id;
          IF COALESCE(v_is_admin, FALSE) THEN
            RETURN TRUE;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.admins') IS NOT NULL THEN
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admins'
          AND column_name = 'user_id'
      )
      INTO v_has_admins_user_id;

      IF v_has_admins_user_id THEN
        EXECUTE
          'SELECT EXISTS (
             SELECT 1
             FROM public.admins
             WHERE id = $1 OR user_id = $1
           )'
        INTO v_is_admin
        USING p_user_id;
      ELSE
        EXECUTE
          'SELECT EXISTS (
             SELECT 1
             FROM public.admins
             WHERE id = $1
           )'
        INTO v_is_admin
        USING p_user_id;
      END IF;

      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT EXISTS (
           SELECT 1
           FROM public.profiles
           WHERE id = $1
             AND LOWER(COALESCE(role, '''')) = ''admin''
         )'
      INTO v_is_admin
      USING p_user_id;
      IF COALESCE(v_is_admin, FALSE) THEN
        RETURN TRUE;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  RETURN FALSE;
END;
$$;
