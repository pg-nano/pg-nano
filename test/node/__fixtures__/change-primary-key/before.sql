-- Non-composite primary key.
CREATE TABLE "user" (
  name text PRIMARY KEY
);

-- Foreign key constraint.
CREATE TABLE "post" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content text NOT NULL,
  author_name text REFERENCES "user" (name)
);

-- Remove a composite primary key.
CREATE TABLE "book" (
  title text,
  edition integer,
  PRIMARY KEY (title, edition)
);

-- Reorder a composite primary key.
CREATE TABLE "flight" (
  airline_code text,
  flight_number integer,
  departure_date date,
  origin text NOT NULL,
  destination text NOT NULL,
  PRIMARY KEY (airline_code, flight_number, departure_date)
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL,
  name text NOT NULL,
  price decimal(10, 2) NOT NULL
);

-- Add primary key to a table without one.
CREATE TABLE "foo" (
  foo_id bigint NOT NULL
);
-- Add a foreign key at the same time as the primary key.
CREATE TABLE "bar" (
  bar_id bigint NOT NULL
);
