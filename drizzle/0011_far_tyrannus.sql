CREATE TABLE "role_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"changed_by" text NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_changes_roles" CHECK ("role_changes"."from_role" in ('user', 'admin') and "role_changes"."to_role" in ('user', 'admin')),
	CONSTRAINT "role_changes_role_changes" CHECK ("role_changes"."from_role" <> "role_changes"."to_role")
);
--> statement-breakpoint
ALTER TABLE "role_changes" ADD CONSTRAINT "role_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_changes" ADD CONSTRAINT "role_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_changes_created_at_idx" ON "role_changes" USING btree ("created_at");