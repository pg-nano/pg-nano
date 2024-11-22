-- noqa: disable=all
DROP VIEW "public"."person_view" CASCADE;
      

      
      
      ALTER TABLE "public"."person" ADD COLUMN first_name text;
    
    

      
      
      ALTER TABLE "public"."person" ADD COLUMN last_name text;
    
################################ Generated plan ################################
1. ALTER TABLE "public"."person" DROP COLUMN "name";
	-- Statement Timeout: 3s
	-- Hazard DELETES_DATA: Deletes all values in the column
