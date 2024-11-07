-- Non-composite primary key.
CREATE TABLE "user" (
  name TEXT PRIMARY KEY
);

-- Foreign key constraint.
CREATE TABLE "post" (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content TEXT NOT NULL,
  author_name TEXT REFERENCES "user" (name)
);

-- Remove a composite primary key.
CREATE TABLE "book" (
  title TEXT,
  edition INTEGER,
  PRIMARY KEY (title, edition)
);

-- Reorder a composite primary key.
CREATE TABLE "flight" (
  airline_code TEXT,
  flight_number INTEGER,
  departure_date DATE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  PRIMARY KEY (airline_code, flight_number, departure_date)
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

-- Add primary key to a table without one.
CREATE TABLE "foo" (
  foo_id SERIAL
);
-- Add a foreign key at the same time as the primary key.
CREATE TABLE "bar" (
  bar_id SERIAL
);
