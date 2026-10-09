CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "people";
--> statement-breakpoint
CREATE SCHEMA "competition";
--> statement-breakpoint
CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "identity"."otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_action" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text,
	"email" text,
	"password_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "people"."player_sports" (
	"player_id" uuid NOT NULL,
	"sport_id" text NOT NULL,
	"playing_role" text DEFAULT '' NOT NULL,
	"skill_level" text DEFAULT '' NOT NULL,
	CONSTRAINT "player_sports_player_id_sport_id_pk" PRIMARY KEY("player_id","sport_id")
);
--> statement-breakpoint
CREATE TABLE "people"."players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"managed_by_user_id" uuid,
	"player_code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"gender" text,
	"dob" date,
	"pincode" text,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "players_player_code_unique" UNIQUE("player_code")
);
--> statement-breakpoint
CREATE TABLE "competition"."sports" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT '' NOT NULL,
	"team_size" integer DEFAULT 1 NOT NULL,
	"max_substitutes" integer DEFAULT 0 NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scoring_module" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "finance"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."player_sports" ADD CONSTRAINT "player_sports_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "people"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."player_sports" ADD CONSTRAINT "player_sports_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "competition"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."players" ADD CONSTRAINT "players_managed_by_user_id_users_id_fk" FOREIGN KEY ("managed_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_created" ON "identity"."otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_ip_created" ON "identity"."otp_challenges" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "identity"."sessions" USING btree ("user_id") WHERE "identity"."sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_logs_entity" ON "platform"."audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_at" ON "platform"."audit_logs" USING btree ("at");