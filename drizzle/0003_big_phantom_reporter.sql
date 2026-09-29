ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_cart_product_size_unique";--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "cart_items" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "product_name" text;--> statement-breakpoint
UPDATE "cart_items" SET "product_name" = "products"."name" FROM "products" WHERE "products"."id" = "cart_items"."product_id";--> statement-breakpoint
ALTER TABLE "cart_items" ALTER COLUMN "product_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_line_unique" ON "cart_items" USING btree ("cart_id","product_id",coalesce("size", '')) WHERE "product_id" is not null;