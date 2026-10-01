CREATE TABLE "product_variants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"label" text,
	"stock" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_variants_stock_nonnegative" CHECK ("product_variants"."stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_label_unique" ON "product_variants" USING btree ("product_id",coalesce(lower("label"), ''));--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill (hand-written). Stock moves from products.stock to one row per size.
-- One-size products get a single variant (null label) holding all their stock.
INSERT INTO "product_variants" ("product_id", "label", "stock", "position")
SELECT "id", NULL, "stock", 0
FROM "products"
WHERE "sizes" IS NULL OR jsonb_typeof("sizes") <> 'array' OR jsonb_array_length("sizes") = 0;--> statement-breakpoint
-- Sized products get one variant per size. The stock is split evenly across the sizes that were
-- available, with the remainder on the first of them; unavailable sizes get 0. (A product with no
-- available size couldn't be bought, so all its sizes get 0.)
WITH "s" AS (
	SELECT p."id" AS "product_id", p."stock", e."value"->>'label' AS "label",
		coalesce((e."value"->>'available')::boolean, true) AS "available", (e."ord" - 1)::int AS "position"
	FROM "products" p, jsonb_array_elements(p."sizes") WITH ORDINALITY AS e("value", "ord")
	WHERE jsonb_typeof(p."sizes") = 'array'
),
"ranked" AS (
	SELECT "s".*,
		count(*) FILTER (WHERE "available") OVER (PARTITION BY "product_id") AS "available_count",
		row_number() OVER (PARTITION BY "product_id", "available" ORDER BY "position") AS "available_rank"
	FROM "s"
)
INSERT INTO "product_variants" ("product_id", "label", "stock", "position")
SELECT "product_id", "label",
	CASE WHEN NOT "available" THEN 0
		ELSE "stock" / "available_count" + CASE WHEN "available_rank" = 1 THEN "stock" % "available_count" ELSE 0 END
	END,
	"position"
FROM "ranked";--> statement-breakpoint
-- Cart and order lines point at their size, matched by product and label. Cart lines match the label
-- exactly (as they were added), so no two lines of a cart get the same size; a line whose size has
-- since been renamed or removed keeps a null variant and shows as no longer available.
UPDATE "cart_items" ci SET "variant_id" = v."id"
FROM "product_variants" v
WHERE v."product_id" = ci."product_id" AND v."label" IS NOT DISTINCT FROM ci."size";--> statement-breakpoint
UPDATE "order_items" oi SET "variant_id" = v."id"
FROM "product_variants" v
WHERE v."product_id" = oi."product_id" AND coalesce(lower(v."label"), '') = coalesce(lower(oi."size"), '');--> statement-breakpoint
-- Past stock changes of one-size products were to their only variant. Those of sized products were
-- to the shared total, so they keep a null variant.
UPDATE "stock_adjustments" sa SET "variant_id" = v."id"
FROM "product_variants" v
WHERE v."product_id" = sa."product_id" AND v."label" IS NULL;
