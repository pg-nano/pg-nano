CREATE TABLE person (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text
);

CREATE VIEW person_view AS SELECT name FROM person;
