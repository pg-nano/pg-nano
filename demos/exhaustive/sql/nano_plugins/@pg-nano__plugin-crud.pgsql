-- Update a row by primary key
CREATE FUNCTION "public"."update_course"("p_id" "course"."id"%TYPE, updated_data text[])
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course";
BEGIN
  SELECT ctid FROM "public"."course"
    WHERE "id" = p_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."course"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'course_name' THEN _result."course_name" := updated_data[i + 1]::varchar(100);

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."course"
    SET "course_name" = _result."course_name"
    WHERE ctid = _ctid;

  RETURN _result;
END;
$$;

  
-- Get a row by primary key
CREATE FUNCTION "public"."get_course"("p_id" "course"."id"%TYPE)
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  result "public"."course";
BEGIN
  SELECT * FROM "public"."course"
    WHERE "id" = p_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_course"(text[])
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course";
BEGIN
  INSERT INTO "public"."course"
    VALUES ($1[1]::int4, $1[2]::varchar(100))
    RETURNING * INTO _result;

  

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course"(text[])
RETURNS "public"."course"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course";
BEGIN
  SELECT ctid FROM "public"."course"
    WHERE "id" = $1[1]::int4
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."course" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_course"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_course"("p_id" "course"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."course"
    WHERE "id" = p_id;

  RETURN FOUND;
END;
$$;
  
-- Update a row by primary key
CREATE FUNCTION "public"."update_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE, updated_data text[])
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course_enrollment";
BEGIN
  SELECT ctid FROM "public"."course_enrollment"
    WHERE "student_id" = p_student_id AND "course_id" = p_course_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."course_enrollment"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'enrollment_date' THEN _result."enrollment_date" := updated_data[i + 1]::date;
      WHEN 'grade' THEN _result."grade" := updated_data[i + 1]::bpchar(1);

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."course_enrollment"
    SET "enrollment_date" = _result."enrollment_date", "grade" = _result."grade"
    WHERE ctid = _ctid;

  RETURN _result;
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
    WHERE "student_id" = p_student_id AND "course_id" = p_course_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_course_enrollment"(text[])
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course_enrollment";
BEGIN
  INSERT INTO "public"."course_enrollment"
    VALUES ($1[1]::int4, $1[2]::int4, $1[3]::date, $1[4]::bpchar(1))
    RETURNING * INTO _result;

  

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_course_enrollment"(text[])
RETURNS "public"."course_enrollment"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."course_enrollment";
BEGIN
  SELECT ctid FROM "public"."course_enrollment"
    WHERE "student_id" = $1[1]::int4 AND "course_id" = $1[2]::int4
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."course_enrollment" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_course_enrollment"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_course_enrollment"("p_student_id" "course_enrollment"."student_id"%TYPE,"p_course_id" "course_enrollment"."course_id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."course_enrollment"
    WHERE "student_id" = p_student_id AND "course_id" = p_course_id;

  RETURN FOUND;
END;
$$;
  
-- Update a row by primary key
CREATE FUNCTION "public"."update_student"("p_id" "student"."id"%TYPE, updated_data text[])
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."student";
BEGIN
  SELECT ctid FROM "public"."student"
    WHERE "id" = p_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."student"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'first_name' THEN _result."first_name" := updated_data[i + 1]::varchar(50);
      WHEN 'last_name' THEN _result."last_name" := updated_data[i + 1]::varchar(50);

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."student"
    SET "first_name" = _result."first_name", "last_name" = _result."last_name"
    WHERE ctid = _ctid;

  RETURN _result;
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
    WHERE "id" = p_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_student"(text[])
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."student";
BEGIN
  INSERT INTO "public"."student"
    VALUES ($1[1]::int4, $1[2]::varchar(50), $1[3]::varchar(50))
    RETURNING * INTO _result;

  

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_student"(text[])
RETURNS "public"."student"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."student";
BEGIN
  SELECT ctid FROM "public"."student"
    WHERE "id" = $1[1]::int4
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."student" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_student"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_student"("p_id" "student"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."student"
    WHERE "id" = p_id;

  RETURN FOUND;
END;
$$;
  
-- Update a row by primary key
CREATE FUNCTION "public"."update_foo"("p_id" "foo"."id"%TYPE, updated_data text[])
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."foo";
BEGIN
  SELECT ctid FROM "public"."foo"
    WHERE "id" = p_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."foo"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'name' THEN _result."name" := updated_data[i + 1]::varchar(100);
      WHEN 'description' THEN _result."description" := updated_data[i + 1];
      WHEN 'created_at' THEN _result."created_at" := updated_data[i + 1]::timestamptz;
      WHEN 'updated_at' THEN _result."updated_at" := updated_data[i + 1]::timestamptz;
      WHEN 'is_active' THEN _result."is_active" := updated_data[i + 1]::bool;
      WHEN 'score' THEN _result."score" := updated_data[i + 1]::numeric(5, 2);
      WHEN 'tags' THEN _result."tags" := updated_data[i + 1]::text[];
      WHEN 'matrix' THEN _result."matrix" := updated_data[i + 1]::float8[][];
      WHEN 'metadata' THEN _result."metadata" := updated_data[i + 1]::jsonb;
      WHEN 'color_preference' THEN _result."color_preference" := updated_data[i + 1]::varchar(20);
      WHEN 'binary_data' THEN _result."binary_data" := updated_data[i + 1]::bytea;
      WHEN 'coordinates' THEN _result."coordinates" := updated_data[i + 1]::point;
      WHEN 'ip_address' THEN _result."ip_address" := updated_data[i + 1]::inet;
      WHEN 'mac_address' THEN _result."mac_address" := updated_data[i + 1]::macaddr;
      WHEN 'price_range' THEN _result."price_range" := updated_data[i + 1]::int4range;
      WHEN 'schedule' THEN _result."schedule" := updated_data[i + 1]::tstzrange;
      WHEN 'priority' THEN _result."priority" := updated_data[i + 1]::int2;
      WHEN 'uuid' THEN _result."uuid" := updated_data[i + 1]::uuid;
      WHEN 'search_vector' THEN _result."search_vector" := updated_data[i + 1]::tsvector;
      WHEN 'status' THEN _result."status" := updated_data[i + 1]::"public"."status_type";
      WHEN 'address' THEN _result."address" := updated_data[i + 1]::"public"."address_type";
      WHEN 'product_attributes' THEN _result."product_attributes" := updated_data[i + 1]::"public"."hstore";

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."foo"
    SET "name" = _result."name", "description" = _result."description", "created_at" = _result."created_at", "updated_at" = _result."updated_at", "is_active" = _result."is_active", "score" = _result."score", "tags" = _result."tags", "matrix" = _result."matrix", "metadata" = _result."metadata", "color_preference" = _result."color_preference", "binary_data" = _result."binary_data", "coordinates" = _result."coordinates", "ip_address" = _result."ip_address", "mac_address" = _result."mac_address", "price_range" = _result."price_range", "schedule" = _result."schedule", "priority" = _result."priority", "uuid" = _result."uuid", "search_vector" = _result."search_vector", "status" = _result."status", "address" = _result."address", "product_attributes" = _result."product_attributes"
    WHERE ctid = _ctid;

  RETURN _result;
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
    WHERE "id" = p_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_foo"(text[])
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."foo";
BEGIN
  INSERT INTO "public"."foo"
    VALUES ($1[1]::int4, $1[2]::varchar(100), $1[3], DEFAULT, DEFAULT, DEFAULT, $1[7]::numeric(5, 2), $1[8]::text[], $1[9]::float8[][], $1[10]::jsonb, $1[11]::varchar(20), $1[12]::bytea, $1[13]::point, $1[14]::inet, $1[15]::macaddr, $1[16]::int4range, $1[17]::tstzrange, $1[18]::int2, DEFAULT, $1[20]::tsvector, DEFAULT, $1[22]::"public"."address_type", $1[23]::"public"."hstore")
    RETURNING ctid INTO _ctid;

  UPDATE "public"."foo"
  SET "created_at" = COALESCE($1[4]::timestamptz, "created_at"), "updated_at" = COALESCE($1[5]::timestamptz, "updated_at"), "is_active" = COALESCE($1[6]::bool, "is_active"), "uuid" = COALESCE($1[19]::uuid, "uuid"), "status" = COALESCE($1[21]::"public"."status_type", "status")
  WHERE ctid = _ctid
  RETURNING *
  INTO _result;
        

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_foo"(text[])
RETURNS "public"."foo"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."foo";
BEGIN
  SELECT ctid FROM "public"."foo"
    WHERE "id" = $1[1]::int4
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."foo" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_foo"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_foo"("p_id" "foo"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."foo"
    WHERE "id" = p_id;

  RETURN FOUND;
END;
$$;
  
-- Update a row by primary key
CREATE FUNCTION "public"."update_account"("p_id" "account"."id"%TYPE, updated_data text[])
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."account";
BEGIN
  SELECT ctid FROM "public"."account"
    WHERE "id" = p_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."account"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'username' THEN _result."username" := updated_data[i + 1]::varchar(50);
      WHEN 'email' THEN _result."email" := updated_data[i + 1]::varchar(100);
      WHEN 'password_hash' THEN _result."password_hash" := updated_data[i + 1]::varchar(255);
      WHEN 'posts_count' THEN _result."posts_count" := updated_data[i + 1]::int4;
      WHEN 'first_name' THEN _result."first_name" := updated_data[i + 1]::varchar(50);
      WHEN 'last_name' THEN _result."last_name" := updated_data[i + 1]::varchar(50);
      WHEN 'date_of_birth' THEN _result."date_of_birth" := updated_data[i + 1]::date;
      WHEN 'created_at' THEN _result."created_at" := updated_data[i + 1]::timestamptz;
      WHEN 'updated_at' THEN _result."updated_at" := updated_data[i + 1]::timestamptz;
      WHEN 'last_login' THEN _result."last_login" := updated_data[i + 1]::timestamptz;
      WHEN 'is_deleted' THEN _result."is_deleted" := updated_data[i + 1]::bool;

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."account"
    SET "username" = _result."username", "email" = _result."email", "password_hash" = _result."password_hash", "posts_count" = _result."posts_count", "first_name" = _result."first_name", "last_name" = _result."last_name", "date_of_birth" = _result."date_of_birth", "created_at" = _result."created_at", "updated_at" = _result."updated_at", "last_login" = _result."last_login", "is_deleted" = _result."is_deleted"
    WHERE ctid = _ctid;

  RETURN _result;
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
    WHERE "id" = p_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_account"(text[])
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."account";
BEGIN
  INSERT INTO "public"."account"
    VALUES (DEFAULT, $1[2]::varchar(50), $1[3]::varchar(100), $1[4]::varchar(255), DEFAULT, $1[6]::varchar(50), $1[7]::varchar(50), $1[8]::date, DEFAULT, DEFAULT, $1[11]::timestamptz, DEFAULT)
    RETURNING ctid INTO _ctid;

  UPDATE "public"."account"
  SET "id" = COALESCE($1[1]::int, "id"), "posts_count" = COALESCE($1[5]::int4, "posts_count"), "created_at" = COALESCE($1[9]::timestamptz, "created_at"), "updated_at" = COALESCE($1[10]::timestamptz, "updated_at"), "is_deleted" = COALESCE($1[12]::bool, "is_deleted")
  WHERE ctid = _ctid
  RETURNING *
  INTO _result;
        

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_account"(text[])
RETURNS "public"."account"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."account";
BEGIN
  SELECT ctid FROM "public"."account"
    WHERE "id" = $1[1]::int
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."account" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_account"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_account"("p_id" "account"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."account"
    WHERE "id" = p_id;

  RETURN FOUND;
END;
$$;
  
-- Update a row by primary key
CREATE FUNCTION "public"."update_post"("p_id" "post"."id"%TYPE, updated_data text[])
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."post";
BEGIN
  SELECT ctid FROM "public"."post"
    WHERE "id" = p_id
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  SELECT * FROM "public"."post"
    WHERE ctid = _ctid
    LIMIT 1
    INTO _result;

  FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
    CASE updated_data[i]
    WHEN 'title' THEN _result."title" := updated_data[i + 1]::varchar(255);
      WHEN 'content' THEN _result."content" := updated_data[i + 1];
      WHEN 'author_id' THEN _result."author_id" := updated_data[i + 1]::int4;
      WHEN 'created_at' THEN _result."created_at" := updated_data[i + 1]::timestamptz;
      WHEN 'updated_at' THEN _result."updated_at" := updated_data[i + 1]::timestamptz;

    ELSE
      RAISE EXCEPTION 'Unknown column: %', updated_data[i];
    END CASE;
  END LOOP;

  UPDATE "public"."post"
    SET "title" = _result."title", "content" = _result."content", "author_id" = _result."author_id", "created_at" = _result."created_at", "updated_at" = _result."updated_at"
    WHERE ctid = _ctid;

  RETURN _result;
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
    WHERE "id" = p_id
    LIMIT 1
    INTO result;

  RETURN result;
END;
$$;

-- Insert a new row
CREATE FUNCTION "public"."create_post"(text[])
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."post";
BEGIN
  INSERT INTO "public"."post"
    VALUES (DEFAULT, $1[2]::varchar(255), $1[3], $1[4]::int4, DEFAULT, DEFAULT)
    RETURNING ctid INTO _ctid;

  UPDATE "public"."post"
  SET "id" = COALESCE($1[1]::int, "id"), "created_at" = COALESCE($1[5]::timestamptz, "created_at"), "updated_at" = COALESCE($1[6]::timestamptz, "updated_at")
  WHERE ctid = _ctid
  RETURNING *
  INTO _result;
        

  RETURN _result;
END;
$$;

-- Upsert a row by primary key
CREATE FUNCTION "public"."upsert_post"(text[])
RETURNS "public"."post"
LANGUAGE plpgsql
AS $$
DECLARE
  _ctid tid;
  _result "public"."post";
BEGIN
  SELECT ctid FROM "public"."post"
    WHERE "id" = $1[1]::int
    LIMIT 1
    INTO _ctid
    FOR UPDATE;

  IF FOUND THEN
    DELETE FROM "public"."post" WHERE ctid = _ctid;
  END IF;

  SELECT * FROM "public"."create_post"($1) INTO _result;
  RETURN _result;
END;
$$;

-- Delete a row by primary key
CREATE FUNCTION "public"."delete_post"("p_id" "post"."id"%TYPE)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "public"."post"
    WHERE "id" = p_id;

  RETURN FOUND;
END;
$$;
  
      