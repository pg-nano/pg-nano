CREATE TABLE course_enrollment (
  student_id int,
  course_id int,
  enrollment_date date,
  grade char(1),
  PRIMARY KEY (student_id, course_id)
);
