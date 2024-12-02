-- noqa: disable=all
ALTER TABLE "public"."user"
DROP CONSTRAINT "user_pkey" CASCADE;

ALTER TABLE "public"."user" ADD COLUMN id SERIAL PRIMARY KEY;
ALTER TABLE "public"."book"
DROP CONSTRAINT "book_pkey" CASCADE;

ALTER TABLE "public"."book" ADD COLUMN id SERIAL PRIMARY KEY;
ALTER TABLE "public"."post" ADD COLUMN author_id BIGINT REFERENCES "user" (id);
CREATE UNIQUE INDEX CONCURRENTLY bar_pkey ON public.bar USING btree (bar_id);

ALTER TABLE "public"."bar" ADD CONSTRAINT "bar_pkey" PRIMARY KEY USING INDEX "bar_pkey";

CREATE UNIQUE INDEX CONCURRENTLY foo_pkey ON public.foo USING btree (foo_id);

ALTER TABLE "public"."foo" ADD CONSTRAINT "foo_pkey" PRIMARY KEY USING INDEX "foo_pkey";

ALTER TABLE "public"."bar" ADD CONSTRAINT "bar_bar_id_fkey" FOREIGN KEY (bar_id) REFERENCES foo(foo_id) NOT VALID;

ALTER TABLE "public"."bar" VALIDATE CONSTRAINT "bar_bar_id_fkey";

ALTER TABLE "public"."post" DROP COLUMN "author_name";

ALTER TABLE "public"."flight" DROP CONSTRAINT "flight_pkey";

CREATE UNIQUE INDEX CONCURRENTLY flight_pkey ON public.flight USING btree (departure_date, airline_code, flight_number);

ALTER TABLE "public"."flight" ADD CONSTRAINT "flight_pkey" PRIMARY KEY USING INDEX "flight_pkey";

ALTER TABLE "public"."product" DROP CONSTRAINT "product_pkey";

CREATE UNIQUE INDEX CONCURRENTLY product_pkey ON public.product USING btree (sku);

ALTER TABLE "public"."product" ADD CONSTRAINT "product_pkey" PRIMARY KEY USING INDEX "product_pkey";
