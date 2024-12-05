CREATE TABLE course_enrollment (
  student_id bigint REFERENCES student (id),
  course_id bigint REFERENCES course (id),
  enrollment_date date NOT NULL,
  grade char(1),
  PRIMARY KEY (student_id, course_id)
);
