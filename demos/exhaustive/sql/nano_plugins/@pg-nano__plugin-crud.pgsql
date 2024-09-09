    
-- Build WHERE clause from conditions
CREATE FUNCTION build_where_clause(conditions JSON)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  where_clause text;
  condition json;
BEGIN
  IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
  where_clause := ' WHERE ';
    FOR condition IN SELECT * FROM json_array_elements(conditions)
    LOOP
    where_clause := where_clause || condition->>'field' || ' ' || condition->>'operator' || ' ' || quote_literal(condition->>'value') || ' AND ';
    END LOOP;
    where_clause := left(where_clause, -5);
  END IF;
  RETURN where_clause;
END;
$$;
  
    