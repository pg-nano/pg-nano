-- noqa: disable=all
DROP VIEW "public"."baz" CASCADE;
ALTER TABLE "public"."bar" DROP COLUMN "foo" CASCADE;
DROP TYPE "public"."foo" CASCADE;
CREATE TYPE foo AS (
  a text,
  b text,
  -- Added another field.
  c text
);
ALTER TABLE "public"."bar"
ADD COLUMN foo foo;
CREATE VIEW baz AS
SELECT
  id,
  foo
FROM bar;
