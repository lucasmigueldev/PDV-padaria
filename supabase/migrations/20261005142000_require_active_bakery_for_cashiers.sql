CREATE OR REPLACE FUNCTION private.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        JOIN public.bakeries AS b
            ON b.id = u.bakery_id
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'cashier'
          AND b.active = true
    );
$function$;
