-- noqa: disable=all
DROP ROUTINE "public"."email_to_text" CASCADE;
DROP ROUTINE "public"."text_to_email" CASCADE;
DROP TYPE "public"."email" CASCADE;
CREATE TYPE public.email AS (
  local_part text,
  -- Changed the domain type.
  domain varchar (256)
);
CREATE FUNCTION public.email_to_text(public.email) RETURNS text AS $$
BEGIN
  RETURN $1.local_part || '@' || $1.domain;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
CREATE CAST (public.email AS text) WITH FUNCTION public.email_to_text(
  public.email
) AS IMPLICIT;
