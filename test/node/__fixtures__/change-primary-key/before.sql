-- Non-composite primary key.
CREATE TABLE "user" (
  name TEXT PRIMARY KEY
);

-- Composite primary key.
CREATE TABLE "book" (
  title TEXT,
  edition INTEGER,
  PRIMARY KEY (title, edition)
);

-- Change primary key with an existing column.
CREATE TABLE "product" (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);
