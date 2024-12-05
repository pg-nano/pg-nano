CREATE SCHEMA nano;

-- This table is used to track rows that are statically inserted into the
-- database via the schema files. This allows us to (1) avoid re-inserting them
-- and (2) detect when the schema file has changed and the rows need to be
-- updated or deleted.
CREATE TABLE nano.inserts (
  hash varchar(32) PRIMARY KEY,
  relname name,
  relnamespace name,
  pk text []
);

-- This index improves the performance of the `DELETE FROM nano.inserts` query
-- that is executed for dropped tables.
CREATE INDEX ON nano.inserts (relnamespace, relname);
