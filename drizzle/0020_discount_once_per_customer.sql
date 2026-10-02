ALTER TABLE "orders" ADD COLUMN "discount_once_per_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-written: orders already placed with a once-per-customer code.
UPDATE "orders" o SET "discount_once_per_customer" = true
FROM "discount_codes" c
WHERE c."id" = o."discount_code_id" AND c."once_per_customer";--> statement-breakpoint
CREATE UNIQUE INDEX "orders_discount_once_per_customer" ON "orders" USING btree ("user_id","discount_code_id") WHERE "orders"."discount_once_per_customer" and "orders"."status" <> 'expired';