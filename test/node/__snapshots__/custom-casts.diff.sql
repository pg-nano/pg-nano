-- noqa: disable=all
DROP ROUTINE "public"."email_to_text" CASCADE;
CREATE FUNCTION public.email_to_text(public.email) RETURNS text AS $$
BEGIN
  RETURN $1.local_part || '@' || $1.domain;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
CREATE CAST (public.email AS text) WITH FUNCTION public.email_to_text(
  public.email
) AS IMPLICIT;
DROP CAST (text AS "public"."email") CASCADE;
DROP FUNCTION "public"."text_to_email"(text);
