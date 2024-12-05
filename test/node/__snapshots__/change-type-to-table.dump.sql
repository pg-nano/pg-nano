-- noqa: disable=all

CREATE SCHEMA nano;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE nano.inserts (
    hash character varying(32) NOT NULL,
    relname name,
    relnamespace name,
    pk text[]
);

CREATE TABLE public.person_name (
    id bigint NOT NULL,
    first_name text,
    last_name text
);

ALTER TABLE public.person_name ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.person_name_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

ALTER TABLE ONLY public.person_name
    ADD CONSTRAINT person_name_pkey PRIMARY KEY (id);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

