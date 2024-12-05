CREATE TABLE person (
  id bigint PRIMARY KEY,
  name text,
  created_at bigint DEFAULT extract(EPOCH FROM now()),
  bio varchar(300)
);

CREATE VIEW person_view AS SELECT
  name,
  created_at
FROM person;
