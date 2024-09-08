    
-- Build WHERE clause from conditions
CREATE FUNCTION build_where_clause(conditions JSON)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
  condition json;
BEGIN
  IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
    query := ' WHERE ';
    FOR condition IN SELECT * FROM json_array_elements(conditions)
    LOOP
      query := query || condition->>'field' || ' ' || condition->>'operator' || ' ' || quote_literal(condition->>'value') || ' AND ';
    END LOOP;
    query := left(query, -5);
  END IF;
  RETURN query;
END;
$$;
  
    
-- Get a row by primary key
CREATE FUNCTION "get_account"("p_id" "account"."id"%TYPE)
RETURNS "account"
LANGUAGE SQL
AS $$
  SELECT * FROM "account" WHERE "id" = "p_id" LIMIT 1;
$$;

-- List rows matching conditions
CREATE FUNCTION "list_account"(conditions JSON)
RETURNS SETOF "account"
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
BEGIN
  query := 'SELECT * FROM "account"' || build_where_clause(conditions);
  RETURN QUERY EXECUTE query;
END;
$$;

-- Find a row by conditions
CREATE FUNCTION "find_account"(conditions JSON)
RETURNS SETOF "account"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM "list_account"(conditions) LIMIT 1;
END;
$$;

-- Count rows matching conditions
CREATE FUNCTION "count_account"(conditions JSON)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
  result bigint;
BEGIN
  query := 'SELECT COUNT(*) FROM "account"' || build_where_clause(conditions);
  EXECUTE query INTO result;
  RETURN result;
END;
$$;

-- Insert a row
CREATE FUNCTION "insert_account"(data "account")
RETURNS "account"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY INSERT INTO "account" SELECT * FROM data RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "upsert_account"(data "account")
RETURNS "account"
LANGUAGE SQL
AS $$
  INSERT INTO "account" SELECT * FROM data
  ON CONFLICT ("id") DO UPDATE
  SET "created_at" = EXCLUDED."created_at","date_of_birth" = EXCLUDED."date_of_birth","email" = EXCLUDED."email","first_name" = EXCLUDED."first_name","id" = EXCLUDED."id","is_deleted" = EXCLUDED."is_deleted","last_login" = EXCLUDED."last_login","last_name" = EXCLUDED."last_name","password_hash" = EXCLUDED."password_hash","updated_at" = EXCLUDED."updated_at","username" = EXCLUDED."username"
  RETURNING *;
$$;

-- Update a row by primary key
CREATE FUNCTION "update_account"("p_id" "account"."id"%TYPE, data JSON)
RETURNS "account"
LANGUAGE plpgsql
AS $$
DECLARE
  update_query text := 'UPDATE "account" SET ';
  key text;
  value json;
BEGIN
  FOR key, value IN SELECT * FROM json_each(data)
  LOOP
    update_query := update_query || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;
  
  update_query := left(update_query, -2); -- Remove trailing comma and space
  update_query := update_query || ' WHERE "id" = "p_id" RETURNING *';
  
  RETURN QUERY EXECUTE update_query;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "replace_account"("p_id" "account"."id"%TYPE, data "account")
RETURNS "account"
LANGUAGE SQL
AS $$
  DELETE FROM "account" WHERE "id" = "p_id";
  INSERT INTO "account" SELECT * FROM data RETURNING *;
$$;

-- Delete a row by primary key
CREATE FUNCTION "delete_account"("p_id" "account"."id"%TYPE)
RETURNS boolean
LANGUAGE SQL
AS $$
  DELETE FROM "account" WHERE "id" = "p_id" RETURNING *;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "get_course_enrollment"("p_course_id" "course_enrollment"."course_id"%TYPE,"p_student_id" "course_enrollment"."student_id"%TYPE)
RETURNS "course_enrollment"
LANGUAGE SQL
AS $$
  SELECT * FROM "course_enrollment" WHERE "course_id" = "p_course_id" AND "student_id" = "p_student_id" LIMIT 1;
$$;

-- List rows matching conditions
CREATE FUNCTION "list_course_enrollment"(conditions JSON)
RETURNS SETOF "course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
BEGIN
  query := 'SELECT * FROM "course_enrollment"' || build_where_clause(conditions);
  RETURN QUERY EXECUTE query;
END;
$$;

-- Find a row by conditions
CREATE FUNCTION "find_course_enrollment"(conditions JSON)
RETURNS SETOF "course_enrollment"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM "list_course_enrollment"(conditions) LIMIT 1;
END;
$$;

-- Count rows matching conditions
CREATE FUNCTION "count_course_enrollment"(conditions JSON)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
  result bigint;
BEGIN
  query := 'SELECT COUNT(*) FROM "course_enrollment"' || build_where_clause(conditions);
  EXECUTE query INTO result;
  RETURN result;
END;
$$;

-- Insert a row
CREATE FUNCTION "insert_course_enrollment"(data "course_enrollment")
RETURNS "course_enrollment"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY INSERT INTO "course_enrollment" SELECT * FROM data RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "upsert_course_enrollment"(data "course_enrollment")
RETURNS "course_enrollment"
LANGUAGE SQL
AS $$
  INSERT INTO "course_enrollment" SELECT * FROM data
  ON CONFLICT ("course_id","student_id") DO UPDATE
  SET "course_id" = EXCLUDED."course_id","enrollment_date" = EXCLUDED."enrollment_date","grade" = EXCLUDED."grade","student_id" = EXCLUDED."student_id"
  RETURNING *;
$$;

-- Update a row by primary key
CREATE FUNCTION "update_course_enrollment"("p_course_id" "course_enrollment"."course_id"%TYPE,"p_student_id" "course_enrollment"."student_id"%TYPE, data JSON)
RETURNS "course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  update_query text := 'UPDATE "course_enrollment" SET ';
  key text;
  value json;
BEGIN
  FOR key, value IN SELECT * FROM json_each(data)
  LOOP
    update_query := update_query || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;
  
  update_query := left(update_query, -2); -- Remove trailing comma and space
  update_query := update_query || ' WHERE "course_id" = "p_course_id" AND "student_id" = "p_student_id" RETURNING *';
  
  RETURN QUERY EXECUTE update_query;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "replace_course_enrollment"("p_course_id" "course_enrollment"."course_id"%TYPE,"p_student_id" "course_enrollment"."student_id"%TYPE, data "course_enrollment")
RETURNS "course_enrollment"
LANGUAGE SQL
AS $$
  DELETE FROM "course_enrollment" WHERE "course_id" = "p_course_id" AND "student_id" = "p_student_id";
  INSERT INTO "course_enrollment" SELECT * FROM data RETURNING *;
$$;

-- Delete a row by primary key
CREATE FUNCTION "delete_course_enrollment"("p_course_id" "course_enrollment"."course_id"%TYPE,"p_student_id" "course_enrollment"."student_id"%TYPE)
RETURNS boolean
LANGUAGE SQL
AS $$
  DELETE FROM "course_enrollment" WHERE "course_id" = "p_course_id" AND "student_id" = "p_student_id" RETURNING *;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "get_foo"("p_id" "foo"."id"%TYPE)
RETURNS "foo"
LANGUAGE SQL
AS $$
  SELECT * FROM "foo" WHERE "id" = "p_id" LIMIT 1;
$$;

-- List rows matching conditions
CREATE FUNCTION "list_foo"(conditions JSON)
RETURNS SETOF "foo"
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
BEGIN
  query := 'SELECT * FROM "foo"' || build_where_clause(conditions);
  RETURN QUERY EXECUTE query;
END;
$$;

-- Find a row by conditions
CREATE FUNCTION "find_foo"(conditions JSON)
RETURNS SETOF "foo"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM "list_foo"(conditions) LIMIT 1;
END;
$$;

-- Count rows matching conditions
CREATE FUNCTION "count_foo"(conditions JSON)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
  result bigint;
BEGIN
  query := 'SELECT COUNT(*) FROM "foo"' || build_where_clause(conditions);
  EXECUTE query INTO result;
  RETURN result;
END;
$$;

-- Insert a row
CREATE FUNCTION "insert_foo"(data "foo")
RETURNS "foo"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY INSERT INTO "foo" SELECT * FROM data RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "upsert_foo"(data "foo")
RETURNS "foo"
LANGUAGE SQL
AS $$
  INSERT INTO "foo" SELECT * FROM data
  ON CONFLICT ("id") DO UPDATE
  SET "address" = EXCLUDED."address","binary_data" = EXCLUDED."binary_data","coordinates" = EXCLUDED."coordinates","created_at" = EXCLUDED."created_at","description" = EXCLUDED."description","id" = EXCLUDED."id","ip_address" = EXCLUDED."ip_address","is_active" = EXCLUDED."is_active","mac_address" = EXCLUDED."mac_address","matrix" = EXCLUDED."matrix","metadata" = EXCLUDED."metadata","name" = EXCLUDED."name","price_range" = EXCLUDED."price_range","priority" = EXCLUDED."priority","product_attributes" = EXCLUDED."product_attributes","schedule" = EXCLUDED."schedule","score" = EXCLUDED."score","search_vector" = EXCLUDED."search_vector","status" = EXCLUDED."status","tags" = EXCLUDED."tags","updated_at" = EXCLUDED."updated_at","uuid" = EXCLUDED."uuid"
  RETURNING *;
$$;

-- Update a row by primary key
CREATE FUNCTION "update_foo"("p_id" "foo"."id"%TYPE, data JSON)
RETURNS "foo"
LANGUAGE plpgsql
AS $$
DECLARE
  update_query text := 'UPDATE "foo" SET ';
  key text;
  value json;
BEGIN
  FOR key, value IN SELECT * FROM json_each(data)
  LOOP
    update_query := update_query || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;
  
  update_query := left(update_query, -2); -- Remove trailing comma and space
  update_query := update_query || ' WHERE "id" = "p_id" RETURNING *';
  
  RETURN QUERY EXECUTE update_query;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "replace_foo"("p_id" "foo"."id"%TYPE, data "foo")
RETURNS "foo"
LANGUAGE SQL
AS $$
  DELETE FROM "foo" WHERE "id" = "p_id";
  INSERT INTO "foo" SELECT * FROM data RETURNING *;
$$;

-- Delete a row by primary key
CREATE FUNCTION "delete_foo"("p_id" "foo"."id"%TYPE)
RETURNS boolean
LANGUAGE SQL
AS $$
  DELETE FROM "foo" WHERE "id" = "p_id" RETURNING *;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "get_post"("p_id" "post"."id"%TYPE)
RETURNS "post"
LANGUAGE SQL
AS $$
  SELECT * FROM "post" WHERE "id" = "p_id" LIMIT 1;
$$;

-- List rows matching conditions
CREATE FUNCTION "list_post"(conditions JSON)
RETURNS SETOF "post"
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
BEGIN
  query := 'SELECT * FROM "post"' || build_where_clause(conditions);
  RETURN QUERY EXECUTE query;
END;
$$;

-- Find a row by conditions
CREATE FUNCTION "find_post"(conditions JSON)
RETURNS SETOF "post"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM "list_post"(conditions) LIMIT 1;
END;
$$;

-- Count rows matching conditions
CREATE FUNCTION "count_post"(conditions JSON)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  query text;
  result bigint;
BEGIN
  query := 'SELECT COUNT(*) FROM "post"' || build_where_clause(conditions);
  EXECUTE query INTO result;
  RETURN result;
END;
$$;

-- Insert a row
CREATE FUNCTION "insert_post"(data "post")
RETURNS "post"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY INSERT INTO "post" SELECT * FROM data RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "upsert_post"(data "post")
RETURNS "post"
LANGUAGE SQL
AS $$
  INSERT INTO "post" SELECT * FROM data
  ON CONFLICT ("id") DO UPDATE
  SET "author_id" = EXCLUDED."author_id","content" = EXCLUDED."content","created_at" = EXCLUDED."created_at","id" = EXCLUDED."id","title" = EXCLUDED."title","updated_at" = EXCLUDED."updated_at"
  RETURNING *;
$$;

-- Update a row by primary key
CREATE FUNCTION "update_post"("p_id" "post"."id"%TYPE, data JSON)
RETURNS "post"
LANGUAGE plpgsql
AS $$
DECLARE
  update_query text := 'UPDATE "post" SET ';
  key text;
  value json;
BEGIN
  FOR key, value IN SELECT * FROM json_each(data)
  LOOP
    update_query := update_query || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;
  
  update_query := left(update_query, -2); -- Remove trailing comma and space
  update_query := update_query || ' WHERE "id" = "p_id" RETURNING *';
  
  RETURN QUERY EXECUTE update_query;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "replace_post"("p_id" "post"."id"%TYPE, data "post")
RETURNS "post"
LANGUAGE SQL
AS $$
  DELETE FROM "post" WHERE "id" = "p_id";
  INSERT INTO "post" SELECT * FROM data RETURNING *;
$$;

-- Delete a row by primary key
CREATE FUNCTION "delete_post"("p_id" "post"."id"%TYPE)
RETURNS boolean
LANGUAGE SQL
AS $$
  DELETE FROM "post" WHERE "id" = "p_id" RETURNING *;
$$;
  