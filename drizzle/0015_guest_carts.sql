ALTER TABLE "carts" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_one_owner" CHECK (("carts"."user_id" is null) <> ("carts"."token_hash" is null));