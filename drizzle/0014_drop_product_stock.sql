ALTER TABLE "products" DROP CONSTRAINT "products_stock_nonnegative";--> statement-breakpoint
DROP INDEX "cart_items_line_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_variant_unique" ON "cart_items" USING btree ("cart_id","variant_id") WHERE "cart_items"."variant_id" is not null;--> statement-breakpoint
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_adjustments_variant_id_idx" ON "stock_adjustments" USING btree ("variant_id");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "stock";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "sizes";