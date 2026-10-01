CREATE TABLE "reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_product_user_unique" UNIQUE("product_id","user_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_title_length" CHECK (char_length("reviews"."title") between 1 and 120),
	CONSTRAINT "reviews_body_length" CHECK (char_length("reviews"."body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_by_user_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_product_id_created_at_idx" ON "reviews" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");