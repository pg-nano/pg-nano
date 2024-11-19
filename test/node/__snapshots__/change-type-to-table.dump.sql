-- noqa: disable=all

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

ALTER TABLE ONLY public.person_name
    ADD CONSTRAINT person_name_pkey PRIMARY KEY (id);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

