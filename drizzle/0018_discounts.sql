CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discount_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal" bigint DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"once_per_customer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_value_positive" CHECK ("discount_codes"."value" > 0),
	CONSTRAINT "discount_codes_value_by_kind" CHECK (("discount_codes"."kind" = 'percent' and "discount_codes"."value" <= 100) or ("discount_codes"."kind" = 'fixed' and "discount_codes"."value" % 100 = 0)),
	CONSTRAINT "discount_codes_min_subtotal" CHECK ("discount_codes"."min_subtotal" >= 0 and "discount_codes"."min_subtotal" % 100 = 0),
	CONSTRAINT "discount_codes_redemptions_nonnegative" CHECK ("discount_codes"."redemptions" >= 0),
	CONSTRAINT "discount_codes_max_redemptions_positive" CHECK ("discount_codes"."max_redemptions" > 0),
	CONSTRAINT "discount_codes_window" CHECK ("discount_codes"."ends_at" > "discount_codes"."starts_at"),
	CONSTRAINT "discount_codes_code_format" CHECK ("discount_codes"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$')
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal" bigint;--> statement-breakpoint
-- Hand-written: orders before discounts had no discount, so their subtotal is their total.
UPDATE "orders" SET "subtotal" = "total";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "subtotal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_code_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_code_unique" ON "discount_codes" USING btree (upper("code"));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_discount_code_id_idx" ON "orders" USING btree ("discount_code_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_nonnegative" CHECK ("orders"."discount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_matches" CHECK ("orders"."total" = "orders"."subtotal" - "orders"."discount");