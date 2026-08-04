-- Keep the privileged retention function callable only by trusted maintenance roles.
REVOKE ALL ON FUNCTION public.prune_suggestion_exposures(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_suggestion_exposures(integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_suggestion_exposures(integer) FROM authenticated;

NOTIFY pgrst, 'reload schema';
