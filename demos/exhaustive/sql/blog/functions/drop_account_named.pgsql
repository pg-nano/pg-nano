CREATE FUNCTION drop_account_named(username varchar)
RETURNS void AS $$
BEGIN
  DELETE FROM account a WHERE a.username = $1;
END;
$$ LANGUAGE plpgsql;
