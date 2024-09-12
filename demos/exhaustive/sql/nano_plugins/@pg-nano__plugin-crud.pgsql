-- Get a row by primary key
CREATE FUNCTION "public"."get_account"("p_id" "account"."id"%TYPE)
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."account";
BEGIN
  SELECT * FROM "public"."account"
    WHERE "id" = "p_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_account"(rec "public"."account")
RETURNS SETOF "public"."account"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."account" VALUES (rec.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_account"(rec "public"."account")
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."account";
BEGIN
  INSERT INTO "public"."account" VALUES (rec.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","username" = EXCLUDED."username","email" = EXCLUDED."email","password_hash" = EXCLUDED."password_hash","posts_count" = EXCLUDED."posts_count","first_name" = EXCLUDED."first_name","last_name" = EXCLUDED."last_name","date_of_birth" = EXCLUDED."date_of_birth","created_at" = EXCLUDED."created_at","updated_at" = EXCLUDED."updated_at","last_login" = EXCLUDED."last_login","is_deleted" = EXCLUDED."is_deleted"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_account"("p_id" "account"."id"%TYPE, data JSON)
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."account" SET ';
  key text;
  value json;
  result "public"."account";
BEGIN
  FOR key, value IN SELECT * FROM json_each(data) LOOP
    sql := sql || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;

  sql := left(sql, -2); -- Remove trailing comma and space
  sql := sql || ' WHERE "id" = "p_id" RETURNING *';

  EXECUTE sql INTO result;
  RETURN result;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "public"."replace_account"("p_id" "account"."id"%TYPE, rec "public"."account")
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."account";
BEGIN
  DELETE FROM "public"."account" WHERE "id" = "p_id";
  INSERT INTO "public"."account" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_account"("p_id" "account"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."account"
    WHERE "id" = "p_id"
    RETURNING *
  )
  SELECT COUNT(*) INTO rows_affected FROM deleted;
  RETURN rows_affected > 0;
END;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "public"."get_foo"("p_id" "foo"."id"%TYPE)
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."foo";
BEGIN
  SELECT * FROM "public"."foo"
    WHERE "id" = "p_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_foo"(rec "public"."foo")
RETURNS SETOF "public"."foo"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."foo" VALUES (rec.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_foo"(rec "public"."foo")
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."foo";
BEGIN
  INSERT INTO "public"."foo" VALUES (rec.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","name" = EXCLUDED."name","description" = EXCLUDED."description","created_at" = EXCLUDED."created_at","updated_at" = EXCLUDED."updated_at","is_active" = EXCLUDED."is_active","score" = EXCLUDED."score","tags" = EXCLUDED."tags","matrix" = EXCLUDED."matrix","metadata" = EXCLUDED."metadata","binary_data" = EXCLUDED."binary_data","coordinates" = EXCLUDED."coordinates","ip_address" = EXCLUDED."ip_address","mac_address" = EXCLUDED."mac_address","price_range" = EXCLUDED."price_range","schedule" = EXCLUDED."schedule","priority" = EXCLUDED."priority","uuid" = EXCLUDED."uuid","search_vector" = EXCLUDED."search_vector","status" = EXCLUDED."status","address" = EXCLUDED."address","product_attributes" = EXCLUDED."product_attributes"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_foo"("p_id" "foo"."id"%TYPE, data JSON)
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."foo" SET ';
  key text;
  value json;
  result "public"."foo";
BEGIN
  FOR key, value IN SELECT * FROM json_each(data) LOOP
    sql := sql || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;

  sql := left(sql, -2); -- Remove trailing comma and space
  sql := sql || ' WHERE "id" = "p_id" RETURNING *';

  EXECUTE sql INTO result;
  RETURN result;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "public"."replace_foo"("p_id" "foo"."id"%TYPE, rec "public"."foo")
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."foo";
BEGIN
  DELETE FROM "public"."foo" WHERE "id" = "p_id";
  INSERT INTO "public"."foo" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_foo"("p_id" "foo"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."foo"
    WHERE "id" = "p_id"
    RETURNING *
  )
  SELECT COUNT(*) INTO rows_affected FROM deleted;
  RETURN rows_affected > 0;
END;
$$;
  
      