-- noqa: disable=all

CREATE SCHEMA nano;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE nano.inserts (
    hash character(32) NOT NULL,
    relname name,
    relnamespace name,
    pk text[]
);

CREATE TABLE public.person_name (
    id integer NOT NULL,
    first_name text,
    last_name text
);

CREATE SEQUENCE public.person_name_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.person_name_id_seq OWNED BY public.person_name.id;

ALTER TABLE ONLY public.person_name ALTER COLUMN id SET DEFAULT nextval('public.person_name_id_seq'::regclass);

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

ALTER TABLE ONLY public.person_name
    ADD CONSTRAINT person_name_pkey PRIMARY KEY (id);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

