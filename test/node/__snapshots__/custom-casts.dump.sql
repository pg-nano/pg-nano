-- noqa: disable=all

CREATE SCHEMA nano;

CREATE TYPE public.email AS (
	local_part text,
	domain character varying(256)
);

CREATE FUNCTION public.email_to_text(public.email) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $_$
BEGIN
  RETURN $1.local_part || '@' || $1.domain;
END;
$_$;

CREATE CAST (public.email AS text) WITH FUNCTION public.email_to_text(public.email) AS IMPLICIT;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE nano.inserts (
    hash character varying(32) NOT NULL,
    relname name,
    relnamespace name,
    pk text[]
);

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

