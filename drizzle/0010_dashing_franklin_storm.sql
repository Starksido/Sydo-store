CREATE TYPE "public"."order_cancel_reason" AS ENUM('out_of_stock', 'payment_issue', 'customer_request', 'other');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('order_cancelled', 'duplicate_payment', 'order_unavailable', 'mismatch');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('due', 'refunded');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"user_id" text,
	"from_status" "order_status" NOT NULL,
	"to_status" "order_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_status_changes" CHECK ("order_events"."from_status" <> "order_events"."to_status"),
	CONSTRAINT "order_events_note_length" CHECK (char_length("order_events"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" "order_cancel_reason";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_carrier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_status" "refund_status";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_reason" "refund_reason";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_detail" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_on" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_recorded_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_recorded_by_user_id_fk" FOREIGN KEY ("refund_recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_refund_status_idx" ON "payments" USING btree ("refund_status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_reason_iff_cancelled" CHECK (("orders"."status" = 'cancelled') = ("orders"."cancel_reason" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_carrier_length" CHECK (char_length("orders"."shipping_carrier") <= 100);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_number_length" CHECK (char_length("orders"."tracking_number") <= 100);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_reason_iff_status" CHECK (("payments"."refund_status" is null) = ("payments"."refund_reason" is null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_recorded" CHECK ("payments"."refund_status" is distinct from 'refunded' or ("payments"."refund_reference" is not null and "payments"."refunded_on" is not null and "payments"."refund_recorded_by" is not null and "payments"."refund_recorded_at" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_reference_length" CHECK (char_length("payments"."refund_reference") <= 100);--> statement-breakpoint
-- Backfill: successful payments that didn't pay their order were only logged as REFUND NEEDED so far.
UPDATE "payments" p
SET "refund_status" = 'due',
	"refund_reason" = CASE WHEN o."payment_reference" IS NOT NULL THEN 'duplicate_payment'::refund_reason ELSE 'order_unavailable'::refund_reason END,
	"refund_detail" = 'Recorded when refund tracking was added'
FROM "orders" o
WHERE o."id" = p."order_id" AND p."status" = 'success' AND p."reference" IS DISTINCT FROM o."payment_reference";
