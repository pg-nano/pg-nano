CREATE TABLE person_name (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  first_name text,
  last_name text
);
