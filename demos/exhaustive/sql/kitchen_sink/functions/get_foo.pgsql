CREATE FUNCTION get_foo(p_id integer)
RETURNS SETOF foo
AS $$
BEGIN
  RETURN QUERY
  SELECT
    *
  FROM
    foo
  WHERE
    id = p_id;
END;
$$
LANGUAGE plpgsql;
