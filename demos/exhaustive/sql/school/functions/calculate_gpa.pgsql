CREATE FUNCTION calculate_gpa(
  IN p_student_id int,
  OUT total_gpa numeric(3, 2)
)
RETURNS numeric(3, 2)
AS $$
DECLARE
  total_points numeric(5, 2) := 0;
  course_count int := 0;
BEGIN
  SELECT
    COALESCE(SUM(grade_points), 0),
    COUNT(*) INTO total_points,
    course_count
  FROM
    report_card
  WHERE
    student_id = p_student_id
    AND grade_points IS NOT NULL;

  IF course_count > 0 THEN
    total_gpa := ROUND(total_points / course_count, 2);
  ELSE
    total_gpa := 0;
  END IF;
END;
$$
LANGUAGE plpgsql;
