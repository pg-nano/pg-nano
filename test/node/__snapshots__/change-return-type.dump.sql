-- noqa: disable=all

CREATE FUNCTION public.test_function() RETURNS TABLE(id text, name text)
    LANGUAGE sql
    AS $$
  SELECT '1', 'test'
$$;

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

