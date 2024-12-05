-- noqa: disable=all
DROP VIEW "public"."person_view" CASCADE;
ALTER TABLE "public"."person"
ADD COLUMN first_name text;
            
ALTER TABLE "public"."person"
ADD COLUMN last_name text;
CREATE VIEW person_view AS
SELECT
  first_name,
  last_name
FROM person;
ALTER TABLE "public"."person" DROP COLUMN "name";
