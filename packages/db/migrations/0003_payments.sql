CREATE TABLE "finance"."ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" text NOT NULL,
	"tournament_id" uuid,
	"payment_id" uuid,
	"payout_id" uuid,
	"debit_paise" integer DEFAULT 0 NOT NULL,
	"credit_paise" integer DEFAULT 0 NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."payment_items" (
	"payment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"fee_paise" integer NOT NULL,
	CONSTRAINT "payment_items_payment_id_enrollment_id_pk" PRIMARY KEY("payment_id","enrollment_id")
);
--> statement-breakpoint
CREATE TABLE "finance"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"entry_fee_paise" integer NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"platform_fee_paise" integer NOT NULL,
	"organiser_share_paise" integer NOT NULL,
	"amount_paid_paise" integer,
	"gateway_fee_paise" integer,
	"convenience_fee_paise" integer,
	"status" text DEFAULT 'created' NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"method" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
CREATE TABLE "finance"."payout_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"holder_name" text NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_last4" text NOT NULL,
	"ifsc" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"organiser_user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"scheduled_on" date NOT NULL,
	"amount_paise" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reference" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "finance"."ledger_entries" ADD CONSTRAINT "ledger_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "finance"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment_items" ADD CONSTRAINT "payment_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "finance"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment_items" ADD CONSTRAINT "payment_items_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "competition"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payments" ADD CONSTRAINT "payments_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payments" ADD CONSTRAINT "payments_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payouts" ADD CONSTRAINT "payouts_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "competition"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payouts" ADD CONSTRAINT "payouts_organiser_user_id_users_id_fk" FOREIGN KEY ("organiser_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_transaction" ON "finance"."ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_account_tournament" ON "finance"."ledger_entries" USING btree ("account","tournament_id");--> statement-breakpoint
CREATE INDEX "payments_tournament_status" ON "finance"."payments" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "payments_payer" ON "finance"."payments" USING btree ("payer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_tournament_sequence" ON "finance"."payouts" USING btree ("tournament_id","sequence");--> statement-breakpoint
CREATE INDEX "payouts_due" ON "finance"."payouts" USING btree ("scheduled_on","status");