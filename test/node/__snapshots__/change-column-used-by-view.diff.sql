-- noqa: disable=all
DROP VIEW "public"."person_view" CASCADE;
ALTER TABLE "public"."person"
DROP COLUMN "created_at" CASCADE;
ALTER TABLE "public"."person"
ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE "public"."person"
ALTER COLUMN "name"
  TYPE varchar(255)
  USING "name"::varchar(255);
CREATE VIEW person_view AS SELECT
  name,
  created_at
FROM person;

