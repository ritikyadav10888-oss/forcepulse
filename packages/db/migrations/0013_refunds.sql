CREATE TABLE "finance"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"razorpay_refund_id" text,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_enrollment_id_unique" UNIQUE("enrollment_id"),
	CONSTRAINT "refunds_razorpay_refund_id_unique" UNIQUE("razorpay_refund_id")
);
--> statement-breakpoint
ALTER TABLE "finance"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "finance"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."refunds" ADD CONSTRAINT "refunds_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "competition"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."refunds" ADD CONSTRAINT "refunds_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;