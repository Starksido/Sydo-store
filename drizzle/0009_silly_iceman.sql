CREATE TYPE "public"."stock_adjustment_reason" AS ENUM('received', 'correction', 'damaged', 'returned', 'other');--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"previous_stock" integer NOT NULL,
	"new_stock" integer NOT NULL,
	"reason" "stock_adjustment_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_delta_nonzero" CHECK ("stock_adjustments"."delta" <> 0),
	CONSTRAINT "stock_adjustments_new_stock_nonnegative" CHECK ("stock_adjustments"."new_stock" >= 0),
	CONSTRAINT "stock_adjustments_delta_matches" CHECK ("stock_adjustments"."new_stock" = "stock_adjustments"."previous_stock" + "stock_adjustments"."delta"),
	CONSTRAINT "stock_adjustments_note_length" CHECK (char_length("stock_adjustments"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustments_product_id_created_at_idx" ON "stock_adjustments" USING btree ("product_id","created_at");