CREATE PROCEDURE create_post (IN p_title text, IN p_content text, IN p_author_id integer)
LANGUAGE plpgsql
AS $$
DECLARE
  new_post_id integer;
BEGIN
  -- Start a transaction
  BEGIN
    -- Insert a new post
    INSERT INTO post (title, content, author_id)
      VALUES (p_title, p_content, p_author_id)
    RETURNING
      id INTO new_post_id;
    -- Increment the posts_count of the author
    UPDATE
      account
    SET
      posts_count = posts_count + 1,
      updated_at = NOW()
    WHERE
      id = p_author_id;
    -- If everything is successful, commit the transaction
    COMMIT;
    RAISE NOTICE 'Post created and author''s post count updated successfully. New post ID: %', new_post_id;
    EXCEPTION
    WHEN OTHERS THEN
      -- If any error occurs, roll back the transaction
      ROLLBACK;
  RAISE EXCEPTION 'Error creating post: %', SQLERRM;
  END;
END;

$$;
