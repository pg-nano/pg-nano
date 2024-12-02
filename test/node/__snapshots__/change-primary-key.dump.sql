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

CREATE TABLE public.bar (
    bar_id integer NOT NULL
);

CREATE SEQUENCE public.bar_bar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bar_bar_id_seq OWNED BY public.bar.bar_id;

CREATE TABLE public.book (
    title text NOT NULL,
    edition integer NOT NULL,
    id integer NOT NULL
);

CREATE SEQUENCE public.book_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.book_id_seq OWNED BY public.book.id;

CREATE TABLE public.flight (
    airline_code text NOT NULL,
    flight_number integer NOT NULL,
    departure_date date NOT NULL,
    origin text NOT NULL,
    destination text NOT NULL
);

CREATE TABLE public.foo (
    foo_id integer NOT NULL
);

CREATE SEQUENCE public.foo_foo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.foo_foo_id_seq OWNED BY public.foo.foo_id;

CREATE TABLE public.post (
    id bigint NOT NULL,
    content text NOT NULL,
    author_id bigint
);

ALTER TABLE public.post ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.post_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.product (
    id integer NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    price numeric(10,2) NOT NULL
);

CREATE SEQUENCE public.product_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.product_id_seq OWNED BY public.product.id;

CREATE TABLE public."user" (
    name text NOT NULL,
    id integer NOT NULL
);

CREATE SEQUENCE public.user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.user_id_seq OWNED BY public."user".id;

ALTER TABLE ONLY public.bar ALTER COLUMN bar_id SET DEFAULT nextval('public.bar_bar_id_seq'::regclass);

ALTER TABLE ONLY public.book ALTER COLUMN id SET DEFAULT nextval('public.book_id_seq'::regclass);

ALTER TABLE ONLY public.foo ALTER COLUMN foo_id SET DEFAULT nextval('public.foo_foo_id_seq'::regclass);

ALTER TABLE ONLY public.product ALTER COLUMN id SET DEFAULT nextval('public.product_id_seq'::regclass);

ALTER TABLE ONLY public."user" ALTER COLUMN id SET DEFAULT nextval('public.user_id_seq'::regclass);

ALTER TABLE ONLY nano.inserts
    ADD CONSTRAINT inserts_pkey PRIMARY KEY (hash);

ALTER TABLE ONLY public.bar
    ADD CONSTRAINT bar_pkey PRIMARY KEY (bar_id);

ALTER TABLE ONLY public.book
    ADD CONSTRAINT book_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.flight
    ADD CONSTRAINT flight_pkey PRIMARY KEY (departure_date, airline_code, flight_number);

ALTER TABLE ONLY public.foo
    ADD CONSTRAINT foo_pkey PRIMARY KEY (foo_id);

ALTER TABLE ONLY public.post
    ADD CONSTRAINT post_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (sku);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bar
    ADD CONSTRAINT bar_bar_id_fkey FOREIGN KEY (bar_id) REFERENCES public.foo(foo_id);

ALTER TABLE ONLY public.post
    ADD CONSTRAINT post_author_id_fkey FOREIGN KEY (author_id) REFERENCES public."user"(id);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;

