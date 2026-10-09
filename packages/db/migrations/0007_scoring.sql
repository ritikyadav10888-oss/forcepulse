CREATE TABLE "competition"."match_events" (
	"match_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"device_ts" timestamp with time zone,
	"server_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "match_events_match_id_seq_pk" PRIMARY KEY("match_id","seq"),
	CONSTRAINT "match_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "competition"."rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"sport_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition"."formats" ADD COLUMN "rules" jsonb;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD COLUMN "rule_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD COLUMN "scorer_device_id" text;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD COLUMN "scorer_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competition"."matches" ADD COLUMN "player_of_match_id" uuid;--> statement-breakpoint
ALTER TABLE "competition"."match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "competition"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."match_events" ADD CONSTRAINT "match_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."rule_sets" ADD CONSTRAINT "rule_sets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition"."rule_sets" ADD CONSTRAINT "rule_sets_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "competition"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_sets_owner" ON "competition"."rule_sets" USING btree ("owner_user_id","sport_id");