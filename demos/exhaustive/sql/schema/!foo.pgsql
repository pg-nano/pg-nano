DROP TABLE IF EXISTS foo;

CREATE TABLE foo (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  is_active boolean DEFAULT TRUE,
  score numeric(5, 2),
  tags text[],
  matrix double precision[][],
  metadata jsonb,
  -- color_preference varchar(20) CHECK (color_preference IN ('red', 'green', 'blue')),
  binary_data bytea,
  coordinates point,
  ip_address inet,
  mac_address macaddr,
  price_range int4range,
  schedule tstzrange,
  priority smallint CHECK (priority BETWEEN 1 AND 5),
  uuid uuid DEFAULT gen_random_uuid (),
  search_vector tsvector
);
