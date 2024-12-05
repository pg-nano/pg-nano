-- noqa: disable=all

CREATE SCHEMA nano;

CREATE TYPE public.foo AS (
	a text,
	b text,
	c text
);

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE nano.inserts (
    hash character varying(32) NOT NULL,
    relname name,
    relnamespace name,
    pk text[]
);

CREATE TABLE public.bar (
    id bigint,
    foo public.foo
);

CREATE VIEW public.baz AS
 SELECT id,
    foo
   FROM public.bar;

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

