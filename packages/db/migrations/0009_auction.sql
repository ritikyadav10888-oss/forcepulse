CREATE SCHEMA "auction";
--> statement-breakpoint
CREATE TABLE "auction"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_points" integer NOT NULL,
	"quota_per_team" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction"."lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"sold_team_id" uuid,
	"sold_points" integer,
	"sold_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction"."plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"max_teams" integer NOT NULL,
	"price_paise" integer
);
--> statement-breakpoint
CREATE TABLE "auction"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"name" text NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"owner_user_id" uuid,
	"competition_team_id" uuid
);
--> statement-breakpoint
CREATE TABLE "auction"."auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"plan_id" text,
	"max_teams" integer DEFAULT 0 NOT NULL,
	"purse" integer DEFAULT 0 NOT NULL,
	"min_squad" integer DEFAULT 1 NOT NULL,
	"max_squad" integer DEFAULT 1 NOT NULL,
	"timer_seconds" integer DEFAULT 30 NOT NULL,
	"lot_order" text DEFAULT 'category' NOT NULL,
	"slabs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"current_lot_id" uuid,
	"current_bid" integer,
	"leading_team_id" uuid,
	"ends_at" timestamp with time zone,
	"paused_remaining_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction"."bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"round" integer NOT NULL,
	"by_user_id" uuid,
	"floor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance"."payments" ADD COLUMN "purpose" text DEFAULT 'registration' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."payments" ADD COLUMN "auction_id" uuid;--> statement-breakpoint
ALTER TABLE "finance"."payments" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "auction"."categories" ADD CONSTRAINT "categories_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "auction"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."lots" ADD CONSTRAINT "lots_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "auction"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."lots" ADD CONSTRAINT "lots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "people"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."lots" ADD CONSTRAINT "lots_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "competition"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."lots" ADD CONSTRAINT "lots_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "auction"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."lots" ADD CONSTRAINT "lots_sold_team_id_teams_id_fk" FOREIGN KEY ("sold_team_id") REFERENCES "auction"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."teams" ADD CONSTRAINT "teams_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "auction"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."teams" ADD CONSTRAINT "teams_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."teams" ADD CONSTRAINT "teams_competition_team_id_teams_id_fk" FOREIGN KEY ("competition_team_id") REFERENCES "competition"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."auctions" ADD CONSTRAINT "auctions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."auctions" ADD CONSTRAINT "auctions_event_id_tournament_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "competition"."tournament_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."auctions" ADD CONSTRAINT "auctions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "competition"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."auctions" ADD CONSTRAINT "auctions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."auctions" ADD CONSTRAINT "auctions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "auction"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."bids" ADD CONSTRAINT "bids_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "auction"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."bids" ADD CONSTRAINT "bids_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "auction"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction"."bids" ADD CONSTRAINT "bids_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_auction_player" ON "auction"."lots" USING btree ("auction_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_event_category" ON "auction"."auctions" USING btree ("event_id",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "bids_lot" ON "auction"."bids" USING btree ("lot_id","id");