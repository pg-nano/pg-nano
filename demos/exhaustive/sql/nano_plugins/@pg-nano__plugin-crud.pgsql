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
CREATE FUNCTION "public"."create_course"(rec "public"."course")
RETURNS SETOF "public"."course"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."course" VALUES (rec.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course"(rec "public"."course")
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course";
BEGIN
  INSERT INTO "public"."course" VALUES (rec.*)
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
CREATE FUNCTION "public"."create_course_enrollment"(rec "public"."course_enrollment")
RETURNS SETOF "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    INSERT INTO "public"."course_enrollment" VALUES (rec.*)
    RETURNING *;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course_enrollment"(rec "public"."course_enrollment")
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course_enrollment";
BEGIN
  INSERT INTO "public"."course_enrollment" VALUES (rec.*)
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
  
      