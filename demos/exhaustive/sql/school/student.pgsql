CREATE TABLE student (
  id int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  first_name varchar(50) NOT NULL,
  last_name varchar(50) NOT NULL,
  full_name varchar(101) NOT NULL GENERATED ALWAYS AS (first_name || ' ' || last_name)
);
