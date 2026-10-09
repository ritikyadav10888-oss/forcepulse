CREATE TABLE "competition"."formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid,
	"type" text NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition"."matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"format_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"group_name" text,
	"round" integer NOT NULL,
	"match_no" integer NOT NULL,
	"home_entrant_id" uuid,
	"away_entrant_id" uuid,
	"home_source" text,
	"away_source" text,
	"court" text,
	"scheduled_at" timestamp with time zone,
	"scorer_user_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"winner_entrant_id" uuid,
	"result_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition"."formats" ADD CONSTRAINT "formats_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."formats" ADD CONSTRAINT "formats_event_id_tournament_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "competition"."tournament_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."formats" ADD CONSTRAINT "formats_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "competition"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD CONSTRAINT "matches_format_id_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "competition"."formats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD CONSTRAINT "matches_scorer_user_id_users_id_fk" FOREIGN KEY ("scorer_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formats_event_category" ON "competition"."formats" USING btree ("event_id",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "matches_tournament" ON "competition"."matches" USING btree ("tournament_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "matches_format" ON "competition"."matches" USING btree ("format_id","stage","round");