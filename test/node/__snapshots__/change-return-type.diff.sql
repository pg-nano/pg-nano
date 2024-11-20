-- noqa: disable=all
DROP ROUTINE "public"."test_function" CASCADE;
CREATE FUNCTION test_function() RETURNS TABLE (id text, name text) AS $$
  SELECT '1', 'test'
$$ LANGUAGE sql
