CREATE FUNCTION delete_account (integer)
  RETURNS boolean
  AS $$
DECLARE
  account_exists boolean;
BEGIN
  -- Check if the account exists
  SELECT
    EXISTS (
      SELECT
        1
      FROM
        account
      WHERE
        id = $1
        AND is_deleted = FALSE) INTO account_exists;
  -- If the account exists and is not already deleted, mark it as deleted
  IF account_exists THEN
    UPDATE
      account
    SET
      is_deleted = TRUE,
      updated_at = CURRENT_TIMESTAMP
    WHERE
      id = $1;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$
LANGUAGE plpgsql;
