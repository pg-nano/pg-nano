-- Non-composite primary key.
CREATE TABLE "user" (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Foreign key constraint.
CREATE TABLE "post" (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content TEXT NOT NULL,
  author_id BIGINT REFERENCES "user" (id)
);

-- Remove a composite primary key.
CREATE TABLE "book" (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  edition INTEGER NOT NULL
);

-- Reorder a composite primary key.
CREATE TABLE "flight" (
  airline_code TEXT,
  flight_number INTEGER,
  departure_date DATE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  PRIMARY KEY (departure_date, airline_code, flight_number)
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id SERIAL NOT NULL,
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

-- Add primary key to a table without one.
CREATE TABLE "foo" (
  foo_id SERIAL,
  -- Declare the primary key constraint separately from the column definition to
  -- ensure that it's supported by pg-nano.
  PRIMARY KEY (foo_id)
);
-- Add a foreign key at the same time as the primary key.
CREATE TABLE "bar" (
  bar_id SERIAL PRIMARY KEY,
  FOREIGN KEY (bar_id) REFERENCES "foo" (foo_id)
);
