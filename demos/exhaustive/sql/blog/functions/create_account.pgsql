CREATE FUNCTION create_account (p_username varchar(50), p_email varchar(100), p_password varchar(255), p_salt varchar(255), p_first_name varchar(50) DEFAULT NULL, p_last_name varchar(50) DEFAULT NULL, p_date_of_birth date DEFAULT NULL)
  RETURNS integer
  AS $$
DECLARE
  new_account_id integer;
  hashed_password varchar(255);
BEGIN
  -- Use pgcrypto to hash the password with the provided salt
  hashed_password := crypt(p_password, p_salt);
  INSERT INTO account (username, email, password_hash, first_name, last_name, date_of_birth)
    VALUES (p_username, p_email, hashed_password, p_first_name, p_last_name, p_date_of_birth)
  RETURNING
    id INTO new_account_id;
  RETURN new_account_id;
END;
$$
LANGUAGE plpgsql;
