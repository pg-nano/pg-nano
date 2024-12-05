-- Non-composite primary key.
CREATE TABLE "user" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

-- Foreign key constraint.
CREATE TABLE "post" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content text NOT NULL,
  author_id bigint REFERENCES "user" (id)
);

-- Remove a composite primary key.
CREATE TABLE "book" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  edition integer NOT NULL
);

-- Reorder a composite primary key.
CREATE TABLE "flight" (
  airline_code text,
  flight_number integer,
  departure_date date,
  origin text NOT NULL,
  destination text NOT NULL,
  PRIMARY KEY (departure_date, airline_code, flight_number)
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id bigint NOT NULL,
  sku text PRIMARY KEY,
  name text NOT NULL,
  price decimal(10, 2) NOT NULL
);

-- Add primary key to a table without one.
CREATE TABLE "foo" (
  foo_id bigint GENERATED ALWAYS AS IDENTITY,
  -- Declare the primary key constraint separately from the column definition to
  -- ensure that it's supported by pg-nano.
  PRIMARY KEY (foo_id)
);
-- Add a foreign key at the same time as the primary key.
CREATE TABLE "bar" (
  bar_id bigint PRIMARY KEY,
  FOREIGN KEY (bar_id) REFERENCES "foo" (foo_id)
);
