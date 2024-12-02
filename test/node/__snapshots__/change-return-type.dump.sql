-- noqa: disable=all

CREATE SCHEMA nano;

CREATE FUNCTION public.test_function() RETURNS TABLE(id text, name text)
    LANGUAGE sql
    AS $$
  SELECT '1', 'test'
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE nano.inserts (
    hash character(32) NOT NULL,
    relname name,
    relnamespace name,
    pk text[]
);

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

