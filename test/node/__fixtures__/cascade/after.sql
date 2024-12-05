CREATE TYPE foo AS (
  a text,
  b text,
  -- Added another field.
  c text
);

CREATE TABLE bar (
  id bigint,
  foo foo
);

CREATE VIEW baz AS
SELECT
  id,
  foo
FROM bar;
