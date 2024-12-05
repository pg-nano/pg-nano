CREATE TABLE course (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  course_name varchar(100) NOT NULL
);
