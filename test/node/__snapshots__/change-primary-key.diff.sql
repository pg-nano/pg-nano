-- noqa: disable=all
              
ALTER TABLE "public"."user"
DROP CONSTRAINT "user_pkey" CASCADE;
                
              
              ALTER TABLE "public"."user" ADD COLUMN id SERIAL PRIMARY KEY;
            
              
ALTER TABLE "public"."book"
DROP CONSTRAINT "book_pkey" CASCADE;
                
              
              ALTER TABLE "public"."book" ADD COLUMN id SERIAL PRIMARY KEY;
            


ALTER TABLE "public"."post" ADD COLUMN author_id BIGINT REFERENCES "user" (id);
            

################################ Generated plan ################################
01. CREATE UNIQUE INDEX CONCURRENTLY bar_pkey ON public.bar USING btree (bar_id);
	-- Statement Timeout: 20m0s
	-- Lock Timeout: 3s
	-- Hazard INDEX_BUILD: This might affect database performance. Concurrent index builds require a non-trivial amount of CPU, potentially affecting database performance. They also can take a while but do not lock out writes.

02. ALTER TABLE "public"."bar" ADD CONSTRAINT "bar_pkey" PRIMARY KEY USING INDEX "bar_pkey";
	-- Statement Timeout: 3s

03. CREATE UNIQUE INDEX CONCURRENTLY foo_pkey ON public.foo USING btree (foo_id);
	-- Statement Timeout: 20m0s
	-- Lock Timeout: 3s
	-- Hazard INDEX_BUILD: This might affect database performance. Concurrent index builds require a non-trivial amount of CPU, potentially affecting database performance. They also can take a while but do not lock out writes.

04. ALTER TABLE "public"."foo" ADD CONSTRAINT "foo_pkey" PRIMARY KEY USING INDEX "foo_pkey";
	-- Statement Timeout: 3s

05. ALTER TABLE "public"."bar" ADD CONSTRAINT "bar_bar_id_fkey" FOREIGN KEY (bar_id) REFERENCES foo(foo_id) NOT VALID;
	-- Statement Timeout: 3s

06. ALTER TABLE "public"."bar" VALIDATE CONSTRAINT "bar_bar_id_fkey";
	-- Statement Timeout: 3s

07. ALTER TABLE "public"."post" DROP COLUMN "author_name";
	-- Statement Timeout: 3s
	-- Hazard DELETES_DATA: Deletes all values in the column

08. ALTER TABLE "public"."flight" DROP CONSTRAINT "flight_pkey";
	-- Statement Timeout: 3s
	-- Hazard ACQUIRES_ACCESS_EXCLUSIVE_LOCK: Index drops will lock out all accesses to the table. They should be fast
	-- Hazard INDEX_DROPPED: Dropping this index means queries that use this index might perform worse because they will no longer will be able to leverage it.

09. CREATE UNIQUE INDEX CONCURRENTLY flight_pkey ON public.flight USING btree (departure_date, airline_code, flight_number);
	-- Statement Timeout: 20m0s
	-- Lock Timeout: 3s
	-- Hazard INDEX_BUILD: This might affect database performance. Concurrent index builds require a non-trivial amount of CPU, potentially affecting database performance. They also can take a while but do not lock out writes.

10. ALTER TABLE "public"."flight" ADD CONSTRAINT "flight_pkey" PRIMARY KEY USING INDEX "flight_pkey";
	-- Statement Timeout: 3s

11. ALTER TABLE "public"."product" DROP CONSTRAINT "product_pkey";
	-- Statement Timeout: 3s
	-- Hazard ACQUIRES_ACCESS_EXCLUSIVE_LOCK: Index drops will lock out all accesses to the table. They should be fast
	-- Hazard INDEX_DROPPED: Dropping this index means queries that use this index might perform worse because they will no longer will be able to leverage it.

12. CREATE UNIQUE INDEX CONCURRENTLY product_pkey ON public.product USING btree (sku);
	-- Statement Timeout: 20m0s
	-- Lock Timeout: 3s
	-- Hazard INDEX_BUILD: This might affect database performance. Concurrent index builds require a non-trivial amount of CPU, potentially affecting database performance. They also can take a while but do not lock out writes.

13. ALTER TABLE "public"."product" ADD CONSTRAINT "product_pkey" PRIMARY KEY USING INDEX "product_pkey";
	-- Statement Timeout: 3s
