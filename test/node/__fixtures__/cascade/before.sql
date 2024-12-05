CREATE TYPE foo AS (
  a text,
  b text
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
