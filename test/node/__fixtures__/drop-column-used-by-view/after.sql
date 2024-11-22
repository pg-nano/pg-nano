CREATE TABLE person (
  id serial PRIMARY KEY,
  first_name text,
  last_name text
);

CREATE VIEW person_view AS
SELECT
  first_name,
  last_name
FROM person;
