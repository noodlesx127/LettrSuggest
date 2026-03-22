-- Fix: Replace recursive RLS policies on user_roles with a SECURITY DEFINER helper function.
-- The old policies queried user_roles from within a policy ON user_roles, causing
-- "ERROR: 42P17: infinite recursion detected in policy for relation user_roles"
-- which silently broke all admin role checks on the client side (NavBar isAdmin,
-- AdminGate access check, ApiKeyManager role check all returned null/false).

-- Step 1: Create a SECURITY DEFINER helper function that bypasses RLS
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id AND role = 'admin'
  );
$$;

-- Step 2: Drop the recursive policies
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can write all roles" ON public.user_roles;

-- Step 3: Recreate using the non-recursive helper function
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can write all roles" ON public.user_roles
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
