-- noqa: disable=all
DROP TYPE "public"."person_name" CASCADE;

CREATE TABLE person_name (
  id serial PRIMARY KEY,
  first_name text,
  last_name text
)
