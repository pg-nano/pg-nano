CREATE TABLE post (
  id serial PRIMARY KEY,
  title varchar(255) NOT NULL,
  content text,
  author_id integer REFERENCES account (id),
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups on author_id
CREATE INDEX idx_post_author_id ON post (author_id);

-- Function to update the updated_at timestamp
CREATE FUNCTION update_post_timestamp ()
  RETURNS TRIGGER
  AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

-- Trigger to call the update_post_timestamp function
CREATE TRIGGER update_post_timestamp
  BEFORE UPDATE ON post
  FOR EACH ROW
  EXECUTE FUNCTION update_post_timestamp ();
