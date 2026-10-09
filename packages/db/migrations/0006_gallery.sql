CREATE TABLE "competition"."media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"upload_key" text NOT NULL,
	"type" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_items_upload_key_unique" UNIQUE("upload_key")
);
--> statement-breakpoint
ALTER TABLE "competition"."media_items" ADD CONSTRAINT "media_items_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."media_items" ADD CONSTRAINT "media_items_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_items_tournament" ON "competition"."media_items" USING btree ("tournament_id","created_at");