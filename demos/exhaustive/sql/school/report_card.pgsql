CREATE VIEW report_card AS
SELECT
  ce.student_id,
  s.first_name,
  s.last_name,
  ce.course_id,
  c.course_name,
  ce.enrollment_date,
  ce.grade,
  CASE WHEN ce.grade = 'A' THEN
    4.0
  WHEN ce.grade = 'B' THEN
    3.0
  WHEN ce.grade = 'C' THEN
    2.0
  WHEN ce.grade = 'D' THEN
    1.0
  WHEN ce.grade = 'F' THEN
    0.0
  ELSE
    NULL
  END AS grade_points
FROM
  course_enrollment ce
  JOIN student s ON ce.student_id = s.id
  JOIN course c ON ce.course_id = c.id;
