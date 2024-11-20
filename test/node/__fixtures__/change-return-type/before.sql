CREATE FUNCTION test_function() RETURNS TABLE (id bigint, name text) AS $$
  SELECT 1, 'test'
$$ LANGUAGE sql;
