CREATE TABLE person (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  first_name text,
  last_name text
);

CREATE VIEW person_view AS
SELECT
  first_name,
  last_name
FROM person;
