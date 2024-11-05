-- Non-composite primary key.
CREATE TABLE "user" (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Composite primary key.
CREATE TABLE "book" (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  edition INTEGER NOT NULL
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id SERIAL NOT NULL,
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);
