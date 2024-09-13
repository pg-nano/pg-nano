-- Get a row by primary key
CREATE FUNCTION "public"."get_course"("p_id" "course"."id"%TYPE)
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course";
BEGIN
  SELECT * FROM "public"."course"
    WHERE "id" = "p_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_course"("public"."course")
RETURNS SETOF "public"."course"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."course" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course"("public"."course")
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course";
BEGIN
  INSERT INTO "public"."course" VALUES ($1.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","course_name" = EXCLUDED."course_name"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_course"("p_id" "course"."id"%TYPE, data JSON)
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."course" SET ';
  key text;
  value json;
  result "public"."course";
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
CREATE FUNCTION "public"."replace_course"("p_id" "course"."id"%TYPE, rec "public"."course")
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course";
BEGIN
  DELETE FROM "public"."course" WHERE "id" = "p_id";
  INSERT INTO "public"."course" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_course"("p_id" "course"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."course"
    WHERE "id" = "p_id"
    RETURNING *
  )
  SELECT COUNT(*) INTO rows_affected FROM deleted;
  RETURN rows_affected > 0;
END;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "public"."get_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE)
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course_enrollment";
BEGIN
  SELECT * FROM "public"."course_enrollment"
    WHERE "student_id" = "p_student_id" AND "course_id" = "p_course_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_course_enrollment"("public"."course_enrollment")
RETURNS SETOF "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."course_enrollment" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course_enrollment"("public"."course_enrollment")
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course_enrollment";
BEGIN
  INSERT INTO "public"."course_enrollment" VALUES ($1.*)
  ON CONFLICT ("student_id","course_id") DO UPDATE
  SET "student_id" = EXCLUDED."student_id","course_id" = EXCLUDED."course_id","enrollment_date" = EXCLUDED."enrollment_date","grade" = EXCLUDED."grade"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE, data JSON)
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."course_enrollment" SET ';
  key text;
  value json;
  result "public"."course_enrollment";
BEGIN
  FOR key, value IN SELECT * FROM json_each(data) LOOP
    sql := sql || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
  END LOOP;

  sql := left(sql, -2); -- Remove trailing comma and space
  sql := sql || ' WHERE "student_id" = "p_student_id" AND "course_id" = "p_course_id" RETURNING *';

  EXECUTE sql INTO result;
  RETURN result;
END;
$$;

-- Replace a row by primary key
CREATE FUNCTION "public"."replace_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE, rec "public"."course_enrollment")
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course_enrollment";
BEGIN
  DELETE FROM "public"."course_enrollment" WHERE "student_id" = "p_student_id" AND "course_id" = "p_course_id";
  INSERT INTO "public"."course_enrollment" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."course_enrollment"
    WHERE "student_id" = "p_student_id" AND "course_id" = "p_course_id"
    RETURNING *
  )
  SELECT COUNT(*) INTO rows_affected FROM deleted;
  RETURN rows_affected > 0;
END;
$$;
  
-- Get a row by primary key
CREATE FUNCTION "public"."get_student"("p_id" "student"."id"%TYPE)
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."student";
BEGIN
  SELECT * FROM "public"."student"
    WHERE "id" = "p_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_student"("public"."student")
RETURNS SETOF "public"."student"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."student" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_student"("public"."student")
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."student";
BEGIN
  INSERT INTO "public"."student" VALUES ($1.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","first_name" = EXCLUDED."first_name","last_name" = EXCLUDED."last_name"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_student"("p_id" "student"."id"%TYPE, data JSON)
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."student" SET ';
  key text;
  value json;
  result "public"."student";
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
CREATE FUNCTION "public"."replace_student"("p_id" "student"."id"%TYPE, rec "public"."student")
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."student";
BEGIN
  DELETE FROM "public"."student" WHERE "id" = "p_id";
  INSERT INTO "public"."student" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_student"("p_id" "student"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."student"
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
CREATE FUNCTION "public"."create_foo"("public"."foo")
RETURNS SETOF "public"."foo"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."foo" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_foo"("public"."foo")
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."foo";
BEGIN
  INSERT INTO "public"."foo" VALUES ($1.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","name" = EXCLUDED."name","description" = EXCLUDED."description","created_at" = EXCLUDED."created_at","updated_at" = EXCLUDED."updated_at","is_active" = EXCLUDED."is_active","score" = EXCLUDED."score","tags" = EXCLUDED."tags","matrix" = EXCLUDED."matrix","metadata" = EXCLUDED."metadata","color_preference" = EXCLUDED."color_preference","binary_data" = EXCLUDED."binary_data","coordinates" = EXCLUDED."coordinates","ip_address" = EXCLUDED."ip_address","mac_address" = EXCLUDED."mac_address","price_range" = EXCLUDED."price_range","schedule" = EXCLUDED."schedule","priority" = EXCLUDED."priority","uuid" = EXCLUDED."uuid","search_vector" = EXCLUDED."search_vector","status" = EXCLUDED."status","address" = EXCLUDED."address","product_attributes" = EXCLUDED."product_attributes"
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
CREATE FUNCTION "public"."create_account"("public"."account")
RETURNS SETOF "public"."account"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."account" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_account"("public"."account")
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."account";
BEGIN
  INSERT INTO "public"."account" VALUES ($1.*)
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
CREATE FUNCTION "public"."get_post"("p_id" "post"."id"%TYPE)
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."post";
BEGIN
  SELECT * FROM "public"."post"
    WHERE "id" = "p_id"
    LIMIT 1
    INTO result;
  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_post"("public"."post")
RETURNS SETOF "public"."post"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."post" VALUES ($1.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_post"("public"."post")
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."post";
BEGIN
  INSERT INTO "public"."post" VALUES ($1.*)
  ON CONFLICT ("id") DO UPDATE
  SET "id" = EXCLUDED."id","title" = EXCLUDED."title","content" = EXCLUDED."content","author_id" = EXCLUDED."author_id","created_at" = EXCLUDED."created_at","updated_at" = EXCLUDED."updated_at"
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Update a row by primary key
CREATE FUNCTION "public"."update_post"("p_id" "post"."id"%TYPE, data JSON)
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  sql text := 'UPDATE "public"."post" SET ';
  key text;
  value json;
  result "public"."post";
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
CREATE FUNCTION "public"."replace_post"("p_id" "post"."id"%TYPE, rec "public"."post")
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."post";
BEGIN
  DELETE FROM "public"."post" WHERE "id" = "p_id";
  INSERT INTO "public"."post" VALUES (rec.*) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_post"("p_id" "post"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  rows_affected integer;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."post"
    WHERE "id" = "p_id"
    RETURNING *
  )
  SELECT COUNT(*) INTO rows_affected FROM deleted;
  RETURN rows_affected > 0;
END;
$$;
  
      