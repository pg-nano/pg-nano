CREATE TYPE public.email AS (
  local_part text,
  domain text
);

CREATE FUNCTION public.email_to_text(email public.email) RETURNS text AS $$
BEGIN
  RETURN email.local_part || '@' || email.domain;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION public.text_to_email(text) RETURNS public.email AS $$
DECLARE
  parts text[];
BEGIN
  IF $1 !~ '^[^@]+@[^@]+$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  parts := string_to_array($1, '@');
  RETURN ROW(parts[1], parts[2])::public.email;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE CAST (public.email AS text) WITH FUNCTION public.email_to_text(
  public.email
) AS IMPLICIT;

CREATE CAST (text AS public.email) WITH FUNCTION public.text_to_email(
  text
) AS ASSIGNMENT;
