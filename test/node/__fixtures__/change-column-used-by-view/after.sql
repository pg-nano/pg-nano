CREATE TABLE person (
  id bigint PRIMARY KEY,
  name varchar(255),
  created_at timestamptz DEFAULT now(),
  bio varchar(300)
);

CREATE VIEW person_view AS SELECT
  name,
  created_at
FROM person;
