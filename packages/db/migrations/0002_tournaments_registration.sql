CREATE TABLE "people"."pincodes" (
	"pincode" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"state" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_age" integer,
	"under_age" integer,
	"age_on" date,
	"gender" text DEFAULT 'any' NOT NULL,
	"allow_playing_up" boolean DEFAULT false NOT NULL,
	"proof_required" boolean DEFAULT false NOT NULL,
	"max_teams" integer,
	"fee_paise" integer,
	"field_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition"."enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_no" text NOT NULL,
	"tournament_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid,
	"player_id" uuid NOT NULL,
	"team_id" uuid,
	"is_captain" boolean DEFAULT false NOT NULL,
	"joined_via" text DEFAULT 'form' NOT NULL,
	"status" text NOT NULL,
	"payment_status" text NOT NULL,
	"fee_paise" integer DEFAULT 0 NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"registered_by_user_id" uuid,
	"guardian" jsonb,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"form_version" integer DEFAULT 0 NOT NULL,
	"proof_key" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_registration_no_unique" UNIQUE("registration_no")
);
--> statement-breakpoint
CREATE TABLE "competition"."form_versions" (
	"tournament_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_versions_tournament_id_version_pk" PRIMARY KEY("tournament_id","version")
);
--> statement-breakpoint
CREATE TABLE "competition"."invite_links" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invite_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "competition"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"captain_player_id" uuid NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "competition"."tournament_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"sport_id" text NOT NULL,
	"entry_type" text NOT NULL,
	"pool_formation" text,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_teams" integer,
	"min_players_per_team" integer,
	"max_players_per_team" integer,
	"fee_paise" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition"."tournament_invites" (
	"tournament_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_invites_tournament_id_phone_pk" PRIMARY KEY("tournament_id","phone")
);
--> statement-breakpoint
CREATE TABLE "competition"."tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organiser_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"banner_url" text DEFAULT '' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"venue" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"map_url" text DEFAULT '' NOT NULL,
	"prizes" text DEFAULT '' NOT NULL,
	"rules_text" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"refund_policy" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"registration_deadline" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"invite_mode" text,
	"review_required" boolean DEFAULT false NOT NULL,
	"form_draft" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform"."uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition"."categories" ADD CONSTRAINT "categories_event_id_tournament_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "competition"."tournament_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_event_id_tournament_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "competition"."tournament_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "competition"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "people"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "competition"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."enrollments" ADD CONSTRAINT "enrollments_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."form_versions" ADD CONSTRAINT "form_versions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."invite_links" ADD CONSTRAINT "invite_links_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."teams" ADD CONSTRAINT "teams_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."teams" ADD CONSTRAINT "teams_event_id_tournament_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "competition"."tournament_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."teams" ADD CONSTRAINT "teams_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "competition"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."teams" ADD CONSTRAINT "teams_captain_player_id_players_id_fk" FOREIGN KEY ("captain_player_id") REFERENCES "people"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."tournament_events" ADD CONSTRAINT "tournament_events_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."tournament_events" ADD CONSTRAINT "tournament_events_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "competition"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."tournament_invites" ADD CONSTRAINT "tournament_invites_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."tournaments" ADD CONSTRAINT "tournaments_organiser_user_id_users_id_fk" FOREIGN KEY ("organiser_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."uploads" ADD CONSTRAINT "uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_event_name" ON "competition"."categories" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_one_active" ON "competition"."enrollments" USING btree ("event_id","player_id") WHERE "competition"."enrollments"."status" in ('payment_pending', 'pending_review', 'enrolled', 'waitlisted');--> statement-breakpoint
CREATE INDEX "enrollments_tournament_status" ON "competition"."enrollments" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "enrollments_player" ON "competition"."enrollments" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "enrollments_team" ON "competition"."enrollments" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_name" ON "competition"."teams" USING btree ("event_id",lower("name")) WHERE "competition"."teams"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_events_sport" ON "competition"."tournament_events" USING btree ("tournament_id","sport_id");--> statement-breakpoint
CREATE INDEX "tournaments_organiser" ON "competition"."tournaments" USING btree ("organiser_user_id");--> statement-breakpoint
CREATE INDEX "tournaments_listing" ON "competition"."tournaments" USING btree ("visibility","status","starts_at");