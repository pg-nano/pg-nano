CREATE TABLE person (
  id serial PRIMARY KEY,
  name text
);

CREATE VIEW person_view AS SELECT name FROM person;
