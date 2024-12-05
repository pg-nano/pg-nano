CREATE TYPE public.email AS (
  local_part text,
  -- Changed the domain type.
  domain varchar (256)
);

-- Changed the parameter name.
CREATE FUNCTION public.email_to_text(public.email) RETURNS text AS $$
BEGIN
  RETURN $1.local_part || '@' || $1.domain;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE CAST (public.email AS text) WITH FUNCTION public.email_to_text(
  public.email
) AS IMPLICIT;

-- Removed the text_to_email function.
-- Removed the CAST (text AS public.email) assignment cast.
